import type {
  GeneratedFile,
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  ToolSet,
  TypedToolResult,
} from "ai";

import type { SecretStore } from "@/core/services/secrets";
import type {
  ProviderConfig,
  ReasoningEffort,
  ResolvedModel,
} from "@/core/types/app-state";

export type GenerateModelTextStreamParams = {
  abortSignal?: AbortSignal;
  messages: ModelMessage[];
  maxToolSteps: number;
  model: ResolvedModel;
  onDelta?: (delta: string) => void;
  onEvent?: (eventName: string | null, data: unknown) => void;
  provider: ProviderConfig;
  reasoning?: "provider-default" | ReasoningEffort;
  /** Sampling temperature override from the active agent. */
  temperature?: number;
  providerOptions?: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
  secretStore: SecretStore;
  sessionId?: string;
  system?: string;
  tools?: ToolSet;
  /** Recheck the context budget before every request, including tool follow-ups. */
  prepareMessages?: (messages: ModelMessage[]) => Promise<ModelMessage[]>;
  /**
   * Called by the driver at each safe step boundary (before steps 1+).
   * Returns user messages that arrived mid-run ("steered" input); the driver
   * appends them to the loop's message state via `prepareStep`, so the model
   * sees them before its next step. A whole batch is delivered at once.
   */
  takeSteeredUserInput?: (
    stepNumber: number,
  ) => ModelMessage[] | Promise<ModelMessage[]>;
  /**
   * When steered input is promoted, the caller returns the completed-step
   * count to reset its step budget from, so the agent gets fresh budget to
   * incorporate the correction (opencode parity). Read on every stop check.
   */
  getStepBudgetBase?: () => number;
};

export type GenerateModelTextStreamResult = {
  generatedFiles?: GeneratedFile[];
  text: string;
  toolResults?: TypedToolResult<ToolSet>[];
  usage?: LanguageModelUsage;
  /** Final step usage; aggregate usage is only suitable for billing totals. */
  contextUsage?: LanguageModelUsage;
  stepLimitReached?: boolean;
};

export interface ModelRuntime {
  generateTextStream(
    params: GenerateModelTextStreamParams,
  ): Promise<GenerateModelTextStreamResult>;
}

export type ProviderLanguageModel = LanguageModel;
