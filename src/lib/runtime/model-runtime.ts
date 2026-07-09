import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import {
  createOpenAIClient,
  getOpenAIProviderTools,
} from "@/lib/providers/openai-client";
import { generateCodexTextStream } from "@/lib/openai-codex-client";
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

    if (params.model.transport === "codexResponses") {
      const messages = params.system
        ? [
            {
              role: "system" as const,
              content: params.system,
            },
            ...params.messages,
          ]
        : params.messages;
      const result = await generateCodexTextStream({
        abortSignal: params.abortSignal,
        messages,
        model: params.model.modelId,
        onDelta: params.onDelta,
        onEvent: params.onEvent,
      });

      return {
        text: result.text,
        usage: result.usage,
      };
    }

    const provider = await createOpenAIClient({
      provider: params.provider,
      secretStore: params.secretStore,
    });
    const providerTools = getOpenAIProviderTools(params.model);
    const languageModel =
      params.model.transport === "openaiResponses"
        ? provider.responses(params.model.modelId)
        : provider.chat(params.model.modelId);

    return shouldUseStreamingAISDK()
      ? generateViaAISDK(languageModel, {
          ...params,
          tools: mergeTools(params.tools, providerTools),
        })
      : generateViaAISDKNonStreaming(languageModel, {
          ...params,
          tools: mergeTools(params.tools, providerTools),
        });
  },
};
