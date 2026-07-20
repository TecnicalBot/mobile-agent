import type {
  GeneratedFile,
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  ToolSet,
  TypedToolResult,
} from "ai";

import type { SecretStore } from "@/lib/secrets";
import type {
  ProviderConfig,
  ReasoningEffort,
  ResolvedModel,
} from "@/types/app-state";

export type GenerateModelTextStreamParams = {
  abortSignal?: AbortSignal;
  messages: ModelMessage[];
  maxToolSteps: number;
  model: ResolvedModel;
  onDelta?: (delta: string) => void;
  onEvent?: (eventName: string | null, data: unknown) => void;
  provider: ProviderConfig;
  reasoning?: "provider-default" | ReasoningEffort;
  providerOptions?: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
  secretStore: SecretStore;
  sessionId?: string;
  system?: string;
  tools?: ToolSet;
};

export type GenerateModelTextStreamResult = {
  generatedFiles?: GeneratedFile[];
  text: string;
  toolResults?: TypedToolResult<ToolSet>[];
  usage?: LanguageModelUsage;
  stepLimitReached?: boolean;
};

export interface ModelRuntime {
  generateTextStream(
    params: GenerateModelTextStreamParams,
  ): Promise<GenerateModelTextStreamResult>;
}

export type ProviderLanguageModel = LanguageModel;
