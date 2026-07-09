import type {
  createMCPClient as CreateMCPClient,
  MCPClient,
} from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { Platform } from "react-native";
import "react-native-get-random-values";

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

import { getMcpOAuthAccessToken } from "@/lib/mcp/oauth";
import { secureSecretStore } from "@/lib/secrets";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { McpServerConfig, ToolExecutionRecord } from "@/types/app-state";

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

async function buildMcpHeaders(server: McpServerConfig) {
  const headers =
    server.authMode === "headers"
      ? await secureSecretStore.getMcpHeaderValues(server.id)
      : {};

  if (server.authMode === "oauth") {
    const accessToken = await getMcpOAuthAccessToken(server);

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
  }

  return headers;
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
    const text = (
      content as { content: Array<Record<string, unknown>> }
    ).content
      .map((part) => (part.type === "text" ? part.text : null))
      .filter((part): part is string => typeof part === "string")
      .join("\n");

    if (text.trim()) {
      return summarizeValue(text);
    }
  }

  return summarizeValue(output);
}

export async function createMcpRuntimeTools(params: {
  onRecord?: (record: ToolExecutionRecord) => void;
  servers: McpServerConfig[];
}): Promise<McpRuntimeToolsResult> {
  const clients: MCPClient[] = [];
  const displayNames = new Map<string, string>();
  const serverResults: McpRuntimeServerResult[] = [];
  const toolEntries: Array<[string, ToolSet[string] | unknown]> = [];
  const instructions: string[] = [];

  for (const server of params.servers.filter((item) => item.enabled)) {
    try {
      const headers = await buildMcpHeaders(server);
      const client = await createRuntimeMCPClient({
        clientName: "mobile-agent",
        transport: {
          type: server.transport,
          url: server.url,
          headers,
        },
      });

      clients.push(client);
      const rawDefinitions = await client.listTools();
      for (const t of rawDefinitions.tools) {
        const findEnum = (s: Record<string, unknown>, path = ""): void => {
          // if (
          //   Array.isArray(s.enum) &&
          //   typeof s.type === "string" &&
          //   s.type !== "string"
          // ) {
          //   const vals = s.enum.map((v: unknown) => JSON.stringify(v));
          //   console.log(
          //     `MCP_SCHEMA_NONSTRING_ENUM: tool=${t.name} path=${path} type=${s.type} enum=[${vals.join(",")}]`,
          //   );
          // }
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
      const prefix = createToolPrefix(server);

      for (const [toolName, toolDefinition] of Object.entries(mcpTools)) {
        const prefixedName = `${prefix}_${slugifyToolPart(toolName)}`;
        const displayName = `${server.label} / ${toolName}`;
        const execute = toolDefinition.execute;
        if (typeof execute !== "function") continue;

        displayNames.set(prefixedName, displayName);

        toolEntries.push([
          prefixedName,
          {
            ...toolDefinition,
            execute: async (toolInput: unknown, options: unknown) => {
              const inputSummary = summarizeValue(toolInput);

              try {
                const output = await execute(toolInput, options as never);

                params.onRecord?.(
                  createRecord({
                    toolName: displayName,
                    status: "completed",
                    inputSummary,
                    outputSummary: summarizeMcpOutput(output),
                  }),
                );

                return output;
              } catch (error) {
                params.onRecord?.(
                  createRecord({
                    toolName: displayName,
                    status: "failed",
                    inputSummary,
                    error: getErrorMessage(error),
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

      serverResults.push({
        error: null,
        instructions: client.instructions ?? null,
        server,
        serverInfo: client.serverInfo as Record<string, unknown>,
        toolCount: Object.keys(mcpTools).length,
      });
    } catch (error) {
      serverResults.push({
        error: getErrorMessage(error),
        instructions: null,
        server,
        serverInfo: null,
        toolCount: null,
      });
    }
  }

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

  try {
    const headers = await buildMcpHeaders(server);
    client = await createRuntimeMCPClient({
      clientName: "mobile-agent",
      transport: {
        type: server.transport,
        url: server.url,
        headers,
      },
    });

    const tools = await client.listTools();

    return {
      instructions: client.instructions ?? null,
      serverInfo: client.serverInfo as Record<string, unknown>,
      toolCount: tools.tools.length,
    };
  } finally {
    await client?.close();
  }
}
