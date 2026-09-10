import type { ToolSet } from "ai";

export type PluginEventName =
  | "run:start"
  | "message:delta"
  | "tool:after"
  | "run:complete"
  | "run:failed";

export type PluginToolResult =
  | string
  | {
      output: string;
      metadata?: Record<string, unknown>;
      title?: string;
    };

export type PluginToolDefinition = {
  description: string;
  inputSchema: Record<string, unknown>;
  mutating?: boolean;
  execute(
    args: Record<string, unknown>,
    context: { abortSignal: AbortSignal },
  ): PluginToolResult | Promise<PluginToolResult>;
};

export type PluginHooks = {
  dispose?: () => void | Promise<void>;
  event?: Partial<
    Record<PluginEventName, (payload: unknown) => void | Promise<void>>
  >;
  system?: string[] | ((context: { sessionId: string }) => string[]);
  tool?: Record<string, PluginToolDefinition>;
};

export type PluginHostContext = {
  emit(event: string, payload: unknown): void;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  log(...args: unknown[]): void;
  secrets: PluginKeyValueStore;
  storage: PluginKeyValueStore;
};

export type PluginKeyValueStore = {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export type PluginDefinition = {
  id?: string;
  setup(
    context: PluginHostContext,
    options?: Record<string, unknown>,
  ): PluginHooks | Promise<PluginHooks>;
};

export type LoadedPlugin = {
  hooks: PluginHooks;
  id: string;
};

export type PluginRuntimeSnapshot = {
  autoApprovedToolNames: Set<string>;
  dispatch(event: PluginEventName, payload: unknown): Promise<void>;
  systemParts: string[];
  tools: ToolSet;
};
