import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import {
  createOpenAIClient,
  getOpenAIProviderTools,
} from "@/lib/providers/openai-client";
import {
  generateViaAISDK,
  generateViaAISDKNonStreaming,
  shouldUseStreamingAISDK,
} from "@/lib/runtime/providers/ai-sdk-runtime";
import type { ModelRuntime } from "@/lib/runtime/providers/types";

function mergeTools(
  runtimeTools: Parameters<ModelRuntime["generateTextStream"]>[0]["tools"],
  providerTools: Parameters<ModelRuntime["generateTextStream"]>[0]["tools"],
) {
  if (!runtimeTools && !providerTools) {
    return undefined;
  }

  return {
    ...(runtimeTools ?? {}),
    ...(providerTools ?? {}),
  } as Parameters<ModelRuntime["generateTextStream"]>[0]["tools"];
}

function normalizeCodexOAuthError(error: unknown, modelId: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    (/\b(400|403|404)\b/.test(message) &&
      /model|unsupported|not found|access/i.test(message)) ||
    /model.{0,80}(unavailable|unsupported|not found|access)/i.test(message)
  ) {
    return new Error(
      `Model ${modelId} is unavailable for this ChatGPT account. Choose another Codex model or use an OpenAI API key.`,
    );
  }

  if (/\b401\b|unauthorized/i.test(message)) {
    return new Error("Your ChatGPT session expired. Please connect ChatGPT again.");
  }

  return error instanceof Error ? error : new Error(message);
}

export const modelRuntime: ModelRuntime = {
  async generateTextStream(params) {
    if (params.provider.family === "anthropic") {
      const apiKey = await params.secretStore.getProviderApiKey(params.provider.id);

      if (!apiKey) {
        throw new Error(`Missing API key for provider ${params.provider.label}.`);
      }

      const provider = createAnthropic({
        apiKey,
        baseURL: params.provider.baseUrl ?? undefined,
      });
      const languageModel = provider.languageModel(params.model.modelId);

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, params)
        : generateViaAISDKNonStreaming(languageModel, params);
    }

    if (params.provider.family === "google") {
      const apiKey = await params.secretStore.getProviderApiKey(params.provider.id);

      if (!apiKey) {
        throw new Error(`Missing API key for provider ${params.provider.label}.`);
      }

      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL:
          params.provider.baseUrl ??
          "https://generativelanguage.googleapis.com/v1beta",
      });
      const languageModel = provider.languageModel(params.model.modelId);
      const providerOptions = params.model.supportsImageGeneration
        ? {
            ...(params.providerOptions ?? {}),
            google: {
              ...((params.providerOptions?.google as Record<string, unknown> | undefined) ??
                {}),
              responseModalities: ["TEXT", "IMAGE"] as const,
            },
          }
        : params.providerOptions;

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, {
            ...params,
            providerOptions,
          })
        : generateViaAISDKNonStreaming(languageModel, {
            ...params,
            providerOptions,
          });
    }

    const provider = await createOpenAIClient({
      provider: params.provider,
      secretStore: params.secretStore,
    });
    const providerTools = getOpenAIProviderTools(params.model);
    const languageModel =
      params.model.transport === "openaiResponses" ||
      params.model.transport === "codexResponses"
        ? provider.responses(params.model.modelId)
        : provider.chat(params.model.modelId);

    try {
      return shouldUseStreamingAISDK()
        ? await generateViaAISDK(languageModel, {
            ...params,
            tools: mergeTools(params.tools, providerTools),
          })
        : await generateViaAISDKNonStreaming(languageModel, {
            ...params,
            tools: mergeTools(params.tools, providerTools),
          });
    } catch (error) {
      if (params.model.transport === "codexResponses") {
        throw normalizeCodexOAuthError(error, params.model.modelId);
      }

      throw error;
    }
  },
};
