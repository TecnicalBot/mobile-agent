import type {
  createMCPClient as CreateMCPClient,
  MCPClient,
} from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { Platform } from "react-native";
import "react-native-get-random-values";
import { createMcpTransportOAuthProvider } from "@/modules/mcp/oauth";
import { secureSecretStore } from "@/core/services/secrets";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { McpServerConfig, ToolExecutionRecord } from "@/core/types/app-state";

let cryptoInstalled = false;

async function ensureCryptoInstalled() {
  if (Platform.OS === "web") return;

  if (!cryptoInstalled) {
    const { install } = await import("react-native-quick-crypto");
    install();
    cryptoInstalled = true;
  }
}

type CreateMCPClientArgs = Parameters<typeof CreateMCPClient>;

export async function createRuntimeMCPClient(
  ...args: CreateMCPClientArgs
): Promise<MCPClient> {
  if (Platform.OS === "web") {
    throw new Error("MCP client is not available during web/server export.");
  }

  await ensureCryptoInstalled();

  const { createMCPClient } = await import("@ai-sdk/mcp");

  return createMCPClient(...args);
}

if (
  typeof AbortSignal !== "undefined" &&
  !AbortSignal.prototype.throwIfAborted
) {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) {
      throw this.reason ?? new Error("Aborted");
    }
  };
}

type McpRuntimeServerResult = {
  error: string | null;
  instructions: string | null;
  server: McpServerConfig;
  serverInfo: Record<string, unknown> | null;
  toolCount: number | null;
};

export type McpRuntimeToolsResult = {
  close: () => Promise<void>;
  getToolDisplayName: (toolName: string) => string | null;
  serverResults: McpRuntimeServerResult[];
  systemPrompt: string | undefined;
  tools: ToolSet | undefined;
};

function slugifyToolPart(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "server";
}

function createToolPrefix(server: McpServerConfig) {
  return `mcp_${slugifyToolPart(server.label)}_${server.id.slice(0, 8)}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Failed to connect MCP server.";
}

function parseOAuthErrorMessage(message: string) {
  const descriptionMatch = message.match(
    /["']error_description["']\s*:\s*["']([^"']+)["']/i,
  );
  if (descriptionMatch?.[1]) {
    return descriptionMatch[1];
  }

  return null;
}

function getActionableMcpErrorMessages(error: unknown, depth = 0): string[] {
  if (depth > 4) return [];

  if (error instanceof Error) {
    const nested = getActionableMcpErrorMessages(
      (error as Error & { cause?: unknown }).cause,
      depth + 1,
    );
    const parsedOAuthError = parseOAuthErrorMessage(error.message);
    return [parsedOAuthError ?? error.message, ...nested].filter(Boolean);
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const description =
      typeof record.error_description === "string"
        ? record.error_description
        : null;
    const ownMessage = description
      ? description
      : typeof record.message === "string"
        ? record.message
        : null;
    return [
      ...(ownMessage ? [ownMessage] : []),
      ...getActionableMcpErrorMessages(record.cause, depth + 1),
    ];
  }

  return typeof error === "string" && error.trim() ? [error] : [];
}

function getActionableMcpErrorMessage(errors: unknown[]) {
  const messages = errors
    .flatMap((error) => getActionableMcpErrorMessages(error))
    .map((message) => message.trim())
    .filter(Boolean);
  const specific = messages.find((message) =>
    /error_description|oauth|unauthori[sz]ed|forbidden|invalid_|\b(?:400|401|403|404|409|422|429)\b/i.test(
      message,
    ),
  );

  return specific ?? messages[0] ?? "Failed to connect MCP server.";
}

async function buildMcpHeaders(server: McpServerConfig) {
  const headers =
    server.authMode === "headers"
      ? await secureSecretStore.getMcpHeaderValues(server.id)
      : {};

  return headers;
}

function alternateTransport(
  transport: McpServerConfig["transport"],
): McpServerConfig["transport"] {
  return transport === "http" ? "sse" : "http";
}

const MCP_CONNECTION_TIMEOUT_MS = 10_000;

function waitForMcpOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onLateResolve?: (value: T) => void,
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(new Error("MCP connection timed out or was canceled."));
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        if (settled) {
          onLateResolve?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function connectMcpClient(
  server: McpServerConfig,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  const transports = [server.transport, alternateTransport(server.transport)];
  const failures: unknown[] = [];

  for (const transportType of transports) {
    try {
      return await waitForMcpOperation(
        createRuntimeMCPClient({
          clientName: "mobile-agent",
          maxRetries: 2,
          transport: {
            type: transportType,
            url: server.url,
            headers,
            redirect: "follow",
            authProvider:
              server.authMode === "oauth"
                ? createMcpTransportOAuthProvider(server)
                : undefined,
          },
        }),
        signal,
        (client) => {
          client.close().catch(() => {});
        },
      );
    } catch (error) {
      failures.push(error);
    }
  }

  throw new Error(getActionableMcpErrorMessage(failures));
}

function sanitizeJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...schema };

  if (Array.isArray(result.enum)) {
    if (
      result.type === "boolean" ||
      result.type === "number" ||
      result.type === "integer"
    ) {
      delete result.enum;
    } else if (typeof result.type === "string") {
      const allMatchingType = result.enum.every(
        (v: unknown) => typeof v === result.type,
      );
      if (!allMatchingType) {
        const inferredTypes = new Set(
          result.enum.map((v: unknown) => typeof v),
        );
        if (inferredTypes.size === 1) {
          result.type = inferredTypes.values().next().value;
        }
      }
    } else {
      const types = new Set(result.enum.map((v: unknown) => typeof v));
      if (types.size === 1) {
        result.type = types.values().next().value;
      }
    }
  }

  if (result.properties && typeof result.properties === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      result.properties as Record<string, unknown>,
    )) {
      sanitized[key] =
        value && typeof value === "object"
          ? sanitizeJsonSchema(value as Record<string, unknown>)
          : value;
    }
    result.properties = sanitized;
  }

  if (result.items && typeof result.items === "object") {
    result.items = sanitizeJsonSchema(result.items as Record<string, unknown>);
  }

  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((s: unknown) =>
      s && typeof s === "object"
        ? sanitizeJsonSchema(s as Record<string, unknown>)
        : s,
    );
  }

  if (Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map((s: unknown) =>
      s && typeof s === "object"
        ? sanitizeJsonSchema(s as Record<string, unknown>)
        : s,
    );
  }

  return result;
}

function summarizeMcpOutput(output: unknown) {
  const content = output && typeof output === "object" ? output : null;

  if (
    content &&
    "content" in content &&
    Array.isArray((content as { content?: unknown }).content)
  ) {
    const text = (content as { content: Record<string, unknown>[] }).content
      .map((part) => (part.type === "text" ? part.text : null))
      .filter((part): part is string => typeof part === "string")
      .join("\n");

    if (text.trim()) {
      return summarizeValue(text);
    }
  }

  return summarizeValue(output);
}

function mcpTextOutput(output: unknown): string {
  if (output && typeof output === "object") {
    const content = (output as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = (content as Record<string, unknown>[])
        .map((part) => (part.type === "text" ? part.text : null))
        .filter((part): part is string => typeof part === "string")
        .join("\n");
      if (text.trim()) return text;
    }
  }
  if (typeof output === "string") return output;
  return "";
}

type TermuxExecution = {
  command: string;
  output: string | null;
  taskId: string | null;
};

function extractTermuxExecution(
  isTermux: boolean,
  toolName: string,
  toolInput: unknown,
): TermuxExecution | null {
  if (!isTermux) return null;

  const raw =
    toolInput && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>)
      : {};
  const commandRaw = raw["command"];
  const command = typeof commandRaw === "string" ? commandRaw : "";

  // The shell entry point returns a task id immediately so its output can
  // be streamed live by the read-only terminal view.
  if (toolName === "execute_command") {
    return { taskId: null, command, output: null };
  }
  return null;
}

function extractTaskId(output: unknown): string {
  const seen = new Set<object>();
  const visit = (value: unknown): string => {
    if (typeof value === "string") {
      const direct = value.match(/^t\d+$/);
      if (direct) return direct[0];
      const embedded = value.match(/(?:"(?:id|task_id)"\s*:\s*"|\b)(t\d+)\b/);
      return embedded?.[1] ?? "";
    }
    if (!value || typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    for (const [key, nested] of Object.entries(value)) {
      if (
        (key === "id" || key === "taskId" || key === "task_id") &&
        typeof nested === "string" &&
        /^t\d+$/.test(nested)
      ) {
        return nested;
      }
      const found = visit(nested);
      if (found) return found;
    }
    return "";
  };

  return visit(output) || visit(mcpTextOutput(output));
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function createMcpRuntimeTools(params: {
  keepTool?: (input: {
    annotations?: Record<string, unknown> | null;
    name: string;
  }) => boolean;
  onRecord?: (record: ToolExecutionRecord) => void;
  servers: McpServerConfig[];
  signal?: AbortSignal;
}): Promise<McpRuntimeToolsResult> {
  const clients: MCPClient[] = [];
  const displayNames = new Map<string, string>();
  const serverResults: McpRuntimeServerResult[] = [];
  const toolEntries: [string, ToolSet[string] | unknown][] = [];
  const instructions: string[] = [];

  const enabledServers = params.servers.filter((item) => item.enabled);
  const concurrencyLimit = 4;

  async function connectServer(server: McpServerConfig) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      MCP_CONNECTION_TIMEOUT_MS,
    );
    const abortFromRun = () => controller.abort();
    params.signal?.addEventListener("abort", abortFromRun, { once: true });
    let client: MCPClient | null = null;

    try {
      const headers = await waitForMcpOperation(
        buildMcpHeaders(server),
        controller.signal,
      );
      client = await connectMcpClient(server, headers, controller.signal);

      const rawDefinitions = await waitForMcpOperation(
        client.listTools(),
        controller.signal,
      );
      console.info(
        "[MCPTools] names",
        server.label,
        JSON.stringify(rawDefinitions.tools.map((t) => t.name)),
      );
      for (const t of rawDefinitions.tools) {
        const findEnum = (s: Record<string, unknown>, path = ""): void => {
          if (s.properties && typeof s.properties === "object") {
            for (const [k, v] of Object.entries(
              s.properties as Record<string, unknown>,
            )) {
              if (v && typeof v === "object")
                findEnum(v as Record<string, unknown>, `${path}.${k}`);
            }
          }
          if (s.items && typeof s.items === "object")
            findEnum(s.items as Record<string, unknown>, `${path}[*]`);
        };
        findEnum(t.inputSchema as Record<string, unknown>, "");
      }
      const sanitizedDefinitions = {
        ...rawDefinitions,
        tools: rawDefinitions.tools.map((tool) => ({
          ...tool,
          inputSchema: sanitizeJsonSchema(
            tool.inputSchema as Record<string, unknown>,
          ),
        })),
      };
      const mcpTools = client.toolsFromDefinitions(
        sanitizedDefinitions as never,
      );
      const toolAnnotations = new Map(
        rawDefinitions.tools.map((tool) => [
          tool.name,
          tool.annotations as Record<string, unknown> | null | undefined,
        ]),
      );
      const prefix = createToolPrefix(server);
      let isTermuxServer = false;

      for (const [toolName, toolDefinition] of Object.entries(mcpTools)) {
        if (
          params.keepTool &&
          !params.keepTool({
            annotations: toolAnnotations.get(toolName),
            name: toolName,
          })
        ) {
          continue;
        }

        const prefixedName = `${prefix}_${slugifyToolPart(toolName)}`;
        const displayName = `${server.label} / ${toolName}`;
        const execute = toolDefinition.execute;
        if (typeof execute !== "function") continue;

        const isTermux =
          /termux/i.test(server.label) || toolName === "execute_command";
        if (isTermux) isTermuxServer = true;
        displayNames.set(prefixedName, displayName);

        toolEntries.push([
          prefixedName,
          {
            ...toolDefinition,
            execute: async (toolInput: unknown, options: unknown) => {
              const inputSummary = summarizeValue(toolInput);
              const termux = extractTermuxExecution(
                isTermux,
                toolName,
                toolInput,
              );
              const executionId = termux
                ? `termux-${Date.now()}-${Math.random().toString(36).slice(2)}`
                : undefined;
              if (termux) {
                params.onRecord?.(
                  createRecord({
                    id: executionId,
                    toolName: displayName,
                    status: "running",
                    inputSummary,
                    termux,
                  }),
                );
              }

              try {
                const output = await execute(toolInput, options as never);
                const isShellTask = toolName === "execute_command";
                const taskId = termux && isShellTask ? extractTaskId(output) : null;
                if (termux) {
                  console.info("[TermuxTask] started", toolName, taskId);
                }

                const termuxResult = termux
                  ? {
                      ...termux,
                      output: null,
                      taskId: taskId || null,
                    }
                  : null;

                params.onRecord?.(
                  createRecord({
                    id: executionId,
                    toolName: displayName,
                    status: termux ? "running" : "completed",
                    inputSummary,
                    outputSummary: summarizeMcpOutput(output),
                    termux: termuxResult ?? undefined,
                  }),
                );

                if (termux) {
                  console.info(
                    "[TermuxTask] returning to model",
                    taskId,
                  );
                }

                return output;
              } catch (error) {
                params.onRecord?.(
                  createRecord({
                    id: executionId,
                    toolName: displayName,
                    status: "failed",
                    inputSummary,
                    error: getErrorMessage(error),
                    termux: termux ?? undefined,
                  }),
                );

                throw error;
              }
            },
          },
        ]);
      }

      if (client.instructions?.trim()) {
        instructions.push(
          [`MCP server: ${server.label}`, client.instructions.trim()].join(
            "\n",
          ),
        );
      }

      if (isTermuxServer) {
        instructions.push(
          `MCP server: ${server.label} — Background commands:\n` +
          `- execute_command returns a task id immediately. The task runs in the background.\n` +
          `- Use task_status to check if the task is still running, finished, or failed.\n` +
          `- Use task_log to retrieve the task's combined output.\n` +
          `- Keep polling task_status and task_log until the task reaches a terminal state (finished/failed/stopped/interrupted), then report the result to the user.\n` +
          `- stop_task terminates a running task; task_delete removes a task record.\n` +
          `- Tasks require root access if using su commands.`,
        );
      }

      clients.push(client);

      return {
        error: null,
        instructions: client.instructions ?? null,
        server,
        serverInfo: client.serverInfo as Record<string, unknown>,
        toolCount: Object.keys(mcpTools).length,
      };
    } catch (error) {
      if (client) {
        client.close().catch(() => {});
      }
      return {
        error: getErrorMessage(error),
        instructions: null,
        server,
        serverInfo: null,
        toolCount: null,
      };
    } finally {
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", abortFromRun);
    }
  }

  const results = await runWithConcurrency(
    enabledServers,
    concurrencyLimit,
    connectServer,
  );
  serverResults.push(...results);

  return {
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
    getToolDisplayName: (toolName) => displayNames.get(toolName) ?? null,
    serverResults,
    systemPrompt:
      instructions.length > 0
        ? ["MCP server instructions:", ...instructions].join("\n\n")
        : undefined,
    tools:
      toolEntries.length > 0
        ? (Object.fromEntries(toolEntries) as ToolSet)
        : undefined,
  };
}

export async function testMcpServerConnection(server: McpServerConfig) {
  let client: MCPClient | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    MCP_CONNECTION_TIMEOUT_MS,
  );

  try {
    const headers = await waitForMcpOperation(
      buildMcpHeaders(server),
      controller.signal,
    );
    client = await connectMcpClient(server, headers, controller.signal);

    const tools = await waitForMcpOperation(
      client.listTools(),
      controller.signal,
    );

    return {
      instructions: client.instructions ?? null,
      serverInfo: client.serverInfo as Record<string, unknown>,
      toolCount: tools.tools.length,
    };
  } finally {
    clearTimeout(timeout);
    await client?.close().catch(() => {});
  }
}
