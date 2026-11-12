import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";

export type AcpConnection = {
  /** HTTP(S) root of the ACP bridge. */
  url: string;
  /** Optional bearer token configured on the bridge. */
  token: string;
  /** Absolute directory on the bridge host. Empty means the bridge default. */
  cwd: string;
  /** Plain LAN HTTP requires explicit consent, like the OpenCode harness. */
  allowInsecureLan?: boolean;
};

export type AcpHealth = {
  ok: boolean;
  service: string;
  version: string;
  agent: string;
  agentVersion: string | null;
  cwd: string;
  home: string;
};

export type AcpImplementation = {
  name: string;
  title?: string | null;
  version: string;
};

export type AcpAuthMethod = {
  id: string;
  name: string;
  description?: string | null;
};

/**
 * Connection-scoped authentication identity pushed by agents such as
 * `claude-agent-acp` through `_auth/status_update`. This is informational: the
 * app never receives or stores the underlying credential.
 */
export type AcpAuthStatus = {
  kind: "account" | "api_key" | "external" | "gateway" | "none" | string;
  label: string;
  detail?: string | null;
  account?: {
    plan?: string | null;
    email?: string | null;
    organization?: string | null;
  } | null;
  vendor?: unknown;
};

/** One slash command or skill advertised by the active ACP session. */
export type AcpAvailableCommand = {
  name: string;
  description?: string | null;
  input?: { hint?: string | null } | null;
  _meta?: Record<string, unknown> | null;
};

export type AcpMcpHeader = {
  name: string;
  value: string;
};

/**
 * ACP's remote MCP server entries. Most agents accept HTTP even
 * though it does not advertise `mcpCapabilities`; SSE is passed through for
 * servers that are configured that way.
 */
export type AcpMcpServer =
  | {
      type: "http";
      name: string;
      url: string;
      headers: AcpMcpHeader[];
    }
  | {
      type: "sse";
      name: string;
      url: string;
      headers: AcpMcpHeader[];
    };

export type AcpInitializeResult = {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    load_session?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    mcpCapabilities?: {
      http?: boolean;
      sse?: boolean;
    };
    sessionCapabilities?: {
      resume?: unknown;
      close?: unknown;
      load?: unknown;
      list?: unknown;
      delete?: unknown;
      additionalDirectories?: unknown;
    };
    session_capabilities?: {
      resume?: unknown;
      close?: unknown;
      load?: unknown;
      list?: unknown;
      delete?: unknown;
      additionalDirectories?: unknown;
    };
    auth?: { logout?: unknown };
  };
  agentInfo?: AcpImplementation | null;
  authMethods?: AcpAuthMethod[];
};

export type AcpModel = {
  modelId: string;
  name: string;
  description?: string | null;
};

export type AcpSessionMode = {
  id: string;
  name: string;
  description?: string | null;
};

export type AcpSessionModeState = {
  currentModeId: string;
  availableModes: AcpSessionMode[];
};

export type AcpConfigOptionValue = {
  value: string;
  name: string;
  description?: string | null;
};

export type AcpSessionConfigOption = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: "select" | "boolean" | string;
  currentValue: string | boolean;
  options?: AcpConfigOptionValue[];
};

export type AcpNewSessionResult = {
  sessionId: string;
  models?: {
    availableModels: AcpModel[];
    currentModelId?: string | null;
  } | null;
  modes?: AcpSessionModeState | null;
  configOptions?: AcpSessionConfigOption[] | null;
};

export type AcpResumeSessionResult = {
  models?: AcpNewSessionResult["models"];
  modes?: AcpSessionModeState | null;
  configOptions?: AcpSessionConfigOption[] | null;
};

export type AcpListSessionsResult = {
  sessions: {
    sessionId: string;
    cwd: string;
    title?: string | null;
    updatedAt?: string | null;
    additionalDirectories?: string[];
  }[];
  nextCursor?: string | null;
};

export type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string; uri?: string }
  | { type: "audio"; mimeType: string; data: string }
  | {
      type: "resource";
      resource:
        | { uri: string; mimeType?: string; text: string }
        | { uri: string; mimeType?: string; blob: string };
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      title?: string;
      description?: string;
      size?: number;
    };

export type AcpToolCallContent =
  | {
      type: "content";
      content: AcpContentBlock;
    }
  | {
      type: "diff";
      path: string;
      oldText?: string | null;
      newText: string;
    }
  | {
      type: "terminal";
      terminalId: string;
    };

export type AcpToolCall = {
  toolCallId: string;
  title?: string;
  name?: string | null;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  content?: AcpToolCallContent[];
  locations?: { path: string; line?: number | null }[];
  rawInput?: unknown;
  rawOutput?: unknown;
};

export type AcpSessionUpdate = {
  sessionUpdate: string;
  messageId?: string | null;
  content?: AcpContentBlock | AcpToolCallContent[];
  title?: string | null;
  updatedAt?: string | null;
  toolCallId?: string;
  options?: unknown;
  [key: string]: unknown;
};

export type AcpSessionNotification = {
  sessionId: string;
  update: AcpSessionUpdate;
};

export type AcpPermissionOption = {
  optionId: string;
  name: string;
  kind:
    | "allow_once"
    | "allow_always"
    | "reject_once"
    | "reject_always"
    | string;
};

export type AcpPermissionRequest = {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
};

export type AcpMessage = {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type AcpLogEvent = {
  stream: string;
  line: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isPrivateAddress(host: string) {
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  return /^\[f[cd][0-9a-f]{2}:/i.test(host);
}

/** Same network policy as the OpenCode harness: HTTPS, loopback, or explicit LAN consent. */
export function normalizeAcpUrl(
  value: string,
  options?: { allowInsecureLan?: boolean },
): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Use a bridge URL without credentials, query parameters, or fragments.",
    );
  }
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    throw new Error(
      "Use the computer's LAN address, not its wildcard listening address.",
    );
  }
  const local = LOOPBACK_HOSTS.has(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (local || (options?.allowInsecureLan && isPrivateAddress(url.hostname)))
    )
  ) {
    throw new Error(
      "Use HTTPS for remote bridges, or HTTP on localhost through Termux or a secure tunnel.",
    );
  }
  // Android can resolve localhost to IPv6 first while the bridge binds IPv4.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString().replace(/\/$/, "");
}

function authHeaders(connection: AcpConnection): Record<string, string> {
  const token = connection.token.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function messageID() {
  return `ma-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type AcpClientOptions = {
  /** Agent name used in errors and log messages. */
  agentLabel?: string;
  transport?: typeof globalThis.fetch;
  onMessage?: (message: AcpMessage) => void;
  onLog?: (event: AcpLogEvent) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
  onBridgeEvent?: (event: Record<string, unknown>) => void;
};

export class AcpClient {
  private readonly connection: AcpConnection;
  private readonly transport: typeof globalThis.fetch;
  private readonly options: AcpClientOptions;
  private readonly label: string;
  private readonly pending = new Map<string, PendingRequest>();
  private running = false;
  private streamController: AbortController | null = null;
  private startPromise: Promise<void> | null = null;
  private streamGeneration = 0;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private ready = false;

  constructor(
    connection: AcpConnection,
    options: AcpClientOptions = {},
  ) {
    this.connection = {
      ...connection,
      url: normalizeAcpUrl(connection.url, connection),
    };
    this.transport = options.transport ?? (expoFetch as typeof globalThis.fetch);
    this.options = options;
    this.label = options.agentLabel ?? "ACP agent";
  }

  get baseUrl() {
    return this.connection.url;
  }

  async health(signal?: AbortSignal): Promise<AcpHealth> {
    const response = await this.transport(`${this.connection.url}/health`, {
      headers: authHeaders(this.connection),
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new Error(`Bridge health check failed (${response.status}).`);
    const health = (await response.json()) as AcpHealth;
    if (!health.ok)
      throw new Error(
        `The ${this.label} bridge is running, but its agent process is not available.`,
      );
    return health;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.running = true;
    const generation = ++this.streamGeneration;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.runStream(generation);
    return this.startPromise;
  }

  stop() {
    this.running = false;
    this.streamGeneration += 1;
    this.ready = false;
    this.streamController?.abort();
    this.streamController = null;
    this.rejectPending(new Error(`${this.label} connection closed.`));
    this.rejectReady?.(new Error(`${this.label} connection closed.`));
    this.resolveReady = null;
    this.rejectReady = null;
    this.startPromise = null;
    this.options.onStatus?.("disconnected");
  }

  private async runStream(generation: number) {
    let backoff = 1000;
    while (this.running && generation === this.streamGeneration) {
      const controller = new AbortController();
      this.streamController = controller;
      this.options.onStatus?.(this.ready ? "connected" : "connecting");
      try {
        const response = await this.transport(`${this.connection.url}/events`, {
          headers: {
            ...authHeaders(this.connection),
            Accept: "text/event-stream",
          },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Bridge event stream failed (${response.status}).`);
        }
        // The stream opened; a later drop should not inherit a long backoff.
        backoff = 1000;
        await this.readEvents(response, controller.signal, generation);
      } catch (error) {
        if (!this.running || generation !== this.streamGeneration) break;
        if (!this.ready) {
          this.rejectReady?.(
            error instanceof Error
              ? error
              : new Error(`Could not open the ${this.label} event stream.`),
          );
          this.rejectReady = null;
        }
      }
      if (!this.running || generation !== this.streamGeneration) break;
      this.ready = false;
      this.options.onStatus?.("disconnected");
      this.rejectPending(
        new Error(`${this.label} connection lost. Reconnect before retrying.`),
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }

  private async readEvents(
    response: Response,
    signal: AbortSignal,
    generation: number,
  ) {
    if (!response.body) throw new Error("Bridge returned an empty event stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
          if (generation === this.streamGeneration)
            this.handleEventBlock(raw);
          boundary = buffer.search(/\r?\n\r?\n/);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleEventBlock(raw: string) {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator >= 0 ? line.slice(0, separator) : line;
      const value =
        separator >= 0
          ? line.slice(separator + 1).replace(/^ /, "")
          : "";
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length) return;
    const payload = data.join("\n");

    if (event === "ready") {
      if (!this.running) return;
      this.ready = true;
      // A failed first attempt rejects startPromise, but the stream keeps
      // retrying. Replace it once connected so later requests can recover.
      this.startPromise = Promise.resolve();
      this.options.onStatus?.("connected");
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (event === "log") {
      try {
        const log = JSON.parse(payload) as AcpLogEvent;
        this.options.onLog?.(log);
      } catch {
        this.options.onLog?.({ stream: "bridge", line: payload });
      }
      return;
    }
    if (event === "bridge") {
      try {
        this.options.onBridgeEvent?.(JSON.parse(payload));
      } catch {
        this.options.onBridgeEvent?.({ type: "message", message: payload });
      }
      return;
    }
    if (event !== "message") return;

    let message: AcpMessage;
    try {
      message = JSON.parse(payload) as AcpMessage;
    } catch {
      this.options.onLog?.({ stream: "bridge", line: payload });
      return;
    }
    this.options.onMessage?.(message);
    if (message.id === undefined) return;
    const key = String(message.id);
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new Error(
          `${message.error.message}${message.error.code ? ` (${message.error.code})` : ""}`,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectPending(error: Error) {
    for (const [key, pending] of this.pending) {
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private async post(message: AcpMessage, signal?: AbortSignal) {
    const response = await this.transport(`${this.connection.url}/rpc`, {
      method: "POST",
      headers: {
        ...authHeaders(this.connection),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Bridge rejected the request (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    await this.start();
    const id = messageID();
    const timeoutMs = options?.timeoutMs ?? 30000;
    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
    try {
      await this.post({ jsonrpc: "2.0", id, method, params }, options?.signal);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
      }
      throw error;
    }
    return result;
  }

  async notify(method: string, params?: unknown, signal?: AbortSignal) {
    await this.start();
    await this.post({ jsonrpc: "2.0", method, params }, signal);
  }

  async respond(
    id: string | number,
    result: unknown,
    signal?: AbortSignal,
  ) {
    await this.post({ jsonrpc: "2.0", id, result }, signal);
  }

  async respondError(
    id: string | number,
    code: number,
    message: string,
    signal?: AbortSignal,
  ) {
    await this.post(
      { jsonrpc: "2.0", id, error: { code, message } },
      signal,
    );
  }
}

export function makeAcpClient(
  connection: AcpConnection,
  options?: AcpClientOptions,
): AcpClient {
  return new AcpClient(connection, options);
}

/**
 * Verify a bridge connection using the same handshake the harness uses. The
 * temporary session is closed when the agent supports `session/close`.
 */
export async function testAcpConnection(
  connection: AcpConnection,
  options?: {
    agentLabel?: string;
    transport?: typeof globalThis.fetch;
    signal?: AbortSignal;
  },
) {
  const client = makeAcpClient(connection, {
    agentLabel: options?.agentLabel,
    transport: options?.transport,
  });
  try {
    const health = await client.health(options?.signal);
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      client.start(),
      new Promise<never>((_, reject) => {
        startTimer = setTimeout(
          () =>
            reject(
              new Error(`The ${options?.agentLabel ?? "ACP agent"} bridge event stream timed out.`),
            ),
          20000,
        );
      }),
    ]).finally(() => {
      if (startTimer) clearTimeout(startTimer);
    });
    const initialize = await client.request<AcpInitializeResult>(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          auth: { terminal: false },
        },
        clientInfo: {
          name: "mobile-agent",
          title: "Mobile Agent",
          version: Constants.expoConfig?.version ?? "0.0.0",
        },
      },
      { signal: options?.signal },
    );
    const cwd = connection.cwd.trim() || health.cwd;
    const session = await client.request<AcpNewSessionResult>(
      "session/new",
      { cwd, mcpServers: [] },
      { signal: options?.signal },
    );
    await client
      .request(
        "session/close",
        { sessionId: session.sessionId },
        { timeoutMs: 5000, signal: options?.signal },
      )
      .catch(() => {});
    return { health, initialize, session, cwd };
  } finally {
    client.stop();
  }
}
