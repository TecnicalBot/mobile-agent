import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createOllama } from "ollama-ai-provider-v2";

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

function normalizeCodexOAuthError(error: unknown) {
  const details =
    error && typeof error === "object"
      ? (error as {
          message?: string;
          responseBody?: string;
          statusCode?: number;
        })
      : undefined;
  const message =
    [
      details?.statusCode ? `HTTP ${details.statusCode}` : undefined,
      details?.message,
      details?.responseBody,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(": ") || String(error);

  if (/\b401\b|unauthorized/i.test(message)) {
    return new Error(
      "Your ChatGPT session expired. Please connect ChatGPT again.",
    );
  }

  return new Error(message, {
    cause: error,
  });
}

function prepareCodexOAuthParams(
  params: Parameters<ModelRuntime["generateTextStream"]>[0],
) {
  if (params.model.transport !== "codexResponses") {
    return params;
  }

  const openaiOptions =
    (params.providerOptions?.openai as Record<string, unknown> | undefined) ??
    {};

  return {
    ...params,
    providerOptions: {
      ...(params.providerOptions ?? {}),
      openai: {
        ...openaiOptions,
        instructions: params.system ?? null,
        store: false,
        strictJsonSchema: false,
      },
    },
    requestHeaders: {
      ...(params.requestHeaders ?? {}),
      originator: "opencode",
      ...(params.sessionId ? { "session-id": params.sessionId } : {}),
    },
    // The Codex Responses endpoint expects the prompt in `instructions`.
    // Leaving it here makes the AI SDK add a system/developer input item too.
    system: undefined,
  };
}

export const modelRuntime: ModelRuntime = {
  async generateTextStream(params) {
    if (params.provider.family === "on-device") {
      const { expoAiKit } = await import("expo-ai-kit/ai");
      const onDeviceOptions =
        (params.model.options?.onDevice as
          | {
              backend?: "auto" | "cpu" | "gpu";
              generation?: {
                temperature?: number;
                topK?: number;
                topP?: number;
              };
            }
          | undefined) ?? {};
      const languageModel = expoAiKit(params.model.modelId, {
        backend: onDeviceOptions.backend ?? "auto",
        generation: onDeviceOptions.generation,
      });

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, params)
        : generateViaAISDKNonStreaming(languageModel, params);
    }
    if (params.provider.family === "anthropic") {
      const apiKey = await params.secretStore.getProviderApiKey(
        params.provider.id,
      );

      if (!apiKey) {
        throw new Error(
          `Missing API key for provider ${params.provider.label}.`,
        );
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
      const apiKey = await params.secretStore.getProviderApiKey(
        params.provider.id,
      );

      if (!apiKey) {
        throw new Error(
          `Missing API key for provider ${params.provider.label}.`,
        );
      }

      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL:
          params.provider.baseUrl ??
          "https://generativelanguage.googleapis.com/v1beta",
      });
      const languageModel = provider.languageModel(params.model.modelId);
      const googleOptions =
        (params.providerOptions?.google as
          Record<string, unknown> | undefined) ?? {};
      const providerOptions =
        params.model.supportsImageGeneration || params.model.supportsReasoning
          ? {
              ...(params.providerOptions ?? {}),
              google: {
                ...googleOptions,
                ...(params.model.supportsImageGeneration
                  ? { responseModalities: ["TEXT", "IMAGE"] as const }
                  : {}),
                ...(params.model.supportsReasoning
                  ? {
                      thinkingConfig: {
                        ...((googleOptions.thinkingConfig as
                          Record<string, unknown> | undefined) ?? {}),
                        includeThoughts: true,
                      },
                    }
                  : {}),
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

    if (params.provider.family === "ollama") {
      const ollamaBase = (params.provider.baseUrl ?? "http://localhost:11434")
        .replace(/\/(?:api|v1)\/?$/, "")
        .replace(/\/$/, "");
      const provider = createOllama({
        baseURL: `${ollamaBase}/api`,
      });
      const shouldThink =
        params.model.supportsReasoning &&
        params.reasoning !== "none" &&
        params.reasoning !== undefined;
      const languageModel = provider.chat(params.model.modelId);
      const providerOptions = {
        ...(params.providerOptions ?? {}),
        ollama: {
          ...((params.providerOptions?.ollama as Record<string, unknown>) ??
            {}),
          think: shouldThink,
        },
      };

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, { ...params, providerOptions })
        : generateViaAISDKNonStreaming(languageModel, {
            ...params,
            providerOptions,
          });
    }

    if (params.provider.family === "xai") {
      const apiKey = await params.secretStore.getProviderApiKey(
        params.provider.id,
      );

      if (!apiKey) {
        throw new Error(
          `Missing API key for provider ${params.provider.label}.`,
        );
      }

      const provider = createXai({
        apiKey,
        baseURL: params.provider.baseUrl ?? undefined,
      });
      const languageModel =
        params.model.transport === "openaiResponses"
          ? provider.responses(params.model.modelId)
          : provider.chat(params.model.modelId);

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, params)
        : generateViaAISDKNonStreaming(languageModel, params);
    }

    if (
      params.provider.family === "openai-compatible" &&
      params.model.transport === "openaiCompatible"
    ) {
      const storedApiKey = await params.secretStore.getProviderApiKey(
        params.provider.id,
      );
      const apiKey =
        params.provider.authType === "none"
          ? storedApiKey || "openai-compatible"
          : storedApiKey;

      if (!apiKey) {
        throw new Error(
          `Missing API key for provider ${params.provider.label}.`,
        );
      }

      if (!params.provider.baseUrl) {
        throw new Error(
          `Missing base URL for provider ${params.provider.label}.`,
        );
      }

      const provider = createOpenAICompatible({
        apiKey,
        baseURL: params.provider.baseUrl,
        includeUsage: true,
        name: params.provider.id,
      });
      const languageModel = provider.chatModel(params.model.modelId);
      const compatibleOptions =
        (params.providerOptions?.openaiCompatible as
          Record<string, unknown> | undefined) ?? {};
      const providerOptions =
        params.reasoning !== undefined &&
        params.reasoning !== "provider-default"
          ? {
              ...(params.providerOptions ?? {}),
              openaiCompatible: {
                ...compatibleOptions,
                reasoningEffort: params.reasoning,
              },
            }
          : params.providerOptions;
      const runtimeParams = { ...params, providerOptions };

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, runtimeParams)
        : generateViaAISDKNonStreaming(languageModel, runtimeParams);
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
    const runtimeParams = prepareCodexOAuthParams({
      ...params,
      tools: mergeTools(params.tools, providerTools),
    });

    try {
      return shouldUseStreamingAISDK()
        ? await generateViaAISDK(languageModel, runtimeParams)
        : await generateViaAISDKNonStreaming(languageModel, runtimeParams);
    } catch (error) {
      if (params.model.transport === "codexResponses") {
        throw normalizeCodexOAuthError(error);
      }

      throw error;
    }
  },
};
