import type { ToolSet } from "ai";

import type { PluginOutputRecord } from "@/core/types/app-state";

export type PluginEventName =
  | "run:start"
  | "message:delta"
  | "tool:after"
  | "run:complete"
  | "run:failed";

export type PluginAttachment = {
  filename?: string;
  mime: string;
  uri: string;
};

export type PluginProgressUpdate = {
  metadata?: Record<string, unknown>;
  title?: string;
};

export type PluginToolResult =
  | string
  | {
      attachments?: PluginAttachment[];
      metadata?: Record<string, unknown>;
      mime?: string;
      output: string;
      title?: string;
    };

export type PluginToolRouting = "both" | "model" | "silent" | "user";

export type PluginToolDefinition = {
  description: string;
  inputSchema: Record<string, unknown>;
  mutating?: boolean;
  output?: PluginToolRouting;
  timeoutMs?: number;
  execute(
    args: Record<string, unknown>,
    context: {
      abortSignal: AbortSignal;
      metadata?(update: PluginProgressUpdate): void;
    },
  ): PluginToolResult | Promise<PluginToolResult>;
};

export type PluginActionDefinition = {
  description?: string;
  inputSchema?: Record<string, unknown>;
  mutating?: boolean;
  output?: PluginToolRouting;
  timeoutMs?: number;
  title?: string;
  run(
    args: Record<string, unknown>,
    context: {
      abortSignal: AbortSignal;
      metadata?(update: PluginProgressUpdate): void;
    },
  ): PluginToolResult | Promise<PluginToolResult>;
};

export type PluginActionInfo = {
  description?: string;
  inputSchema?: Record<string, unknown>;
  mutating?: boolean;
  name: string;
  pluginId: string;
  title: string;
};

export type PluginToolInfo = {
  description: string;
  inputSchema: Record<string, unknown>;
  mutating?: boolean;
  name: string;
  pluginId: string;
};

export type PluginHooks = {
  action?: Record<string, PluginActionDefinition>;
  dispose?: () => void | Promise<void>;
  event?: Partial<
    Record<PluginEventName, (payload: unknown) => void | Promise<void>>
  >;
  system?: string[] | ((context: { sessionId: string }) => string[]);
  tool?: Record<string, PluginToolDefinition>;
};

export type PluginAiGenerateOptions = {
  maxTokens?: number;
  system?: string;
  prompt: string;
};

export type PluginHostContext = {
  ai: {
    generate(options: PluginAiGenerateOptions): Promise<string>;
  };
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
  context?: PluginHostContext;
  hooks: PluginHooks;
  id: string;
};

export type PluginRuntimeSnapshot = {
  actions: PluginActionInfo[];
  autoApprovedToolNames: Set<string>;
  dispatch(event: PluginEventName, payload: unknown): Promise<void>;
  pluginOutputs: PluginOutputRecord[];
  runAction(
    pluginId: string,
    name: string,
    args?: Record<string, unknown>,
    onProgress?: (update: PluginProgressUpdate) => void,
  ): Promise<PluginToolResult>;
  runTool(
    pluginId: string,
    name: string,
    args?: Record<string, unknown>,
    onProgress?: (update: PluginProgressUpdate) => void,
  ): Promise<PluginToolResult>;
  systemParts: string[];
  toolInfos: PluginToolInfo[];
  tools: ToolSet;
};
