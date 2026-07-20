import { generateText, stepCountIs, streamText } from "ai";
import { Platform } from "react-native";

import type {
  GenerateModelTextStreamParams,
  ProviderLanguageModel,
} from "@/lib/runtime/providers/types";

export function shouldUseStreamingAISDK() {
  return (
    Platform.OS === "web" || Platform.OS === "android" || Platform.OS === "ios"
  );
}

function shouldFallbackToNonStreaming(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /readablestream|streaming is not supported|async iterator/i.test(
    message,
  );
}

function getRawReasoningDetailsText(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const choices = (rawValue as { choices?: unknown }).choices;

  if (!Array.isArray(choices)) {
    return null;
  }

  const delta = choices[0]?.delta;

  if (!delta || typeof delta !== "object") {
    return null;
  }

  const details = (delta as { reasoning_details?: unknown }).reasoning_details;

  if (typeof details === "string") {
    return details;
  }

  if (!Array.isArray(details)) {
    return null;
  }

  const text = details
    .map((detail) => {
      if (typeof detail === "string") {
        return detail;
      }

      if (!detail || typeof detail !== "object") {
        return "";
      }

      const record = detail as { summary?: unknown; text?: unknown };
      return typeof record.text === "string"
        ? record.text
        : typeof record.summary === "string"
          ? record.summary
          : "";
    })
    .join("");

  return text || null;
}

export async function generateViaAISDK(
  providerModel: ProviderLanguageModel,
  params: GenerateModelTextStreamParams,
) {
  return generateViaAISDKWithContinuation(providerModel, params, 0);
}

async function generateViaAISDKWithContinuation(
  providerModel: ProviderLanguageModel,
  params: GenerateModelTextStreamParams,
  emptyToolContinuationCount: number,
) {
  let finalText = "";
  let providerError: unknown;
  let rawReasoningActive = false;
  let lastRawReasoningDelta: string | null = null;
  const rawReasoningId = "reasoning-0";
  const endRawReasoning = () => {
    if (!rawReasoningActive) {
      return;
    }

    params.onEvent?.("reasoning-end", {
      id: rawReasoningId,
      type: "reasoning-end",
    });
    rawReasoningActive = false;
  };

  try {
    const result = streamText({
      abortSignal: params.abortSignal,
      headers: params.requestHeaders,
      includeRawChunks: params.model.transport === "openaiCompatible",
      model: providerModel,
      messages: params.messages,
      onChunk: ({ chunk }) => {
        if (chunk.type === "raw") {
          const text = getRawReasoningDetailsText(chunk.rawValue);

          if (text) {
            if (!rawReasoningActive) {
              params.onEvent?.("reasoning-start", {
                id: rawReasoningId,
                type: "reasoning-start",
              });
              rawReasoningActive = true;
            }

            params.onEvent?.("reasoning-delta", {
              id: rawReasoningId,
              text,
              type: "reasoning-delta",
            });
            lastRawReasoningDelta = text;
          }

          return;
        }

        if (
          chunk.type === "reasoning-delta" &&
          rawReasoningActive &&
          chunk.id === rawReasoningId &&
          chunk.text === lastRawReasoningDelta
        ) {
          lastRawReasoningDelta = null;
          return;
        }

        if (
          rawReasoningActive &&
          (chunk.type === "text-start" ||
            chunk.type === "tool-input-start" ||
            chunk.type === "finish")
        ) {
          endRawReasoning();
        }

        params.onEvent?.(chunk.type, chunk);
      },
      onError: ({ error }) => {
        providerError ??= error;
        params.onEvent?.("error", error);
      },
      onStepEnd: (step) => {
        params.onEvent?.("step-end", step);
      },
      onStepStart: (step) => {
        params.onEvent?.("step-start", step);
      },
      onToolExecutionEnd: (event) => {
        params.onEvent?.("tool-execution-end", event);
      },
      onToolExecutionStart: (event) => {
        params.onEvent?.("tool-execution-start", event);
      },
      providerOptions: params.providerOptions as any,
      ...(params.reasoning !== undefined
        ? { reasoning: params.reasoning }
        : {}),
      stopWhen: stepCountIs(params.maxToolSteps),
      system: params.system,
      tools: params.tools,
    });

    try {
      for await (const delta of result.textStream) {
        finalText += delta;
        params.onDelta?.(delta);
      }

      endRawReasoning();
      const [, files, responseMessages, toolResults, usage, steps] =
        await Promise.all([
          result.text,
          result.files,
          result.responseMessages,
          result.toolResults,
          result.usage,
          result.steps,
        ]);

      if (
        !finalText.trim() &&
        toolResults.length > 0 &&
        emptyToolContinuationCount < 2 &&
        steps.length < params.maxToolSteps
      ) {
        return generateViaAISDKWithContinuation(
          providerModel,
          {
            ...params,
            maxToolSteps: params.maxToolSteps - steps.length,
            messages: [
              ...params.messages,
              ...responseMessages,
              {
                role: "user",
                content:
                  "Continue the original task using the tool results above. Keep calling tools until the requested work is complete, then provide a final response.",
              },
            ],
          },
          emptyToolContinuationCount + 1,
        );
      }

      return {
        generatedFiles: files,
        text: finalText,
        toolResults,
        usage,
        stepLimitReached:
          steps.length >= params.maxToolSteps &&
          steps.at(-1)?.finishReason === "tool-calls",
      };
    } catch (error) {
      // AI SDK exposes several derived promises. Drain all of them after a
      // failed stream so React Native does not report secondary unhandled
      // NoOutputGeneratedError rejections.
      await Promise.allSettled([
        result.text,
        result.files,
        result.responseMessages,
        result.toolResults,
        result.usage,
        result.steps,
      ]);
      throw providerError ?? error;
    }
  } catch (error) {
    if (
      params.abortSignal?.aborted ||
      finalText.length > 0 ||
      !shouldFallbackToNonStreaming(error)
    ) {
      throw error;
    }

    return generateViaAISDKNonStreaming(providerModel, params);
  }
}

function chunkText(text: string) {
  const segments = text.match(/\S+\s*/g) ?? [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const segment of segments) {
    if ((currentChunk + segment).length > 28 && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = segment;
      continue;
    }

    currentChunk += segment;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [text];
}

export async function generateViaAISDKNonStreaming(
  providerModel: ProviderLanguageModel,
  params: GenerateModelTextStreamParams,
) {
  const result = await generateText({
    abortSignal: params.abortSignal,
    headers: params.requestHeaders,
    model: providerModel,
    messages: params.messages,
    onStepEnd: (step) => {
      params.onEvent?.("step-end", step);
    },
    onStepStart: (step) => {
      params.onEvent?.("step-start", step);
    },
    onToolExecutionEnd: (event) => {
      params.onEvent?.("tool-execution-end", event);
    },
    onToolExecutionStart: (event) => {
      params.onEvent?.("tool-execution-start", event);
    },
    providerOptions: params.providerOptions as any,
    ...(params.reasoning !== undefined ? { reasoning: params.reasoning } : {}),
    stopWhen: stepCountIs(params.maxToolSteps),
    system: params.system,
    tools: params.tools,
  });

  if (result.reasoningText?.trim()) {
    const reasoningId = `non-streaming-${Date.now()}`;
    params.onEvent?.("reasoning-start", {
      id: reasoningId,
      type: "reasoning-start",
    });
    params.onEvent?.("reasoning-delta", {
      id: reasoningId,
      text: result.reasoningText,
      type: "reasoning-delta",
    });
    params.onEvent?.("reasoning-end", {
      id: reasoningId,
      type: "reasoning-end",
    });
  }

  if (result.text) {
    for (const chunk of chunkText(result.text)) {
      if (params.abortSignal?.aborted) {
        throw new Error("Request aborted.");
      }

      params.onDelta?.(chunk);
    }
  }

  return {
    generatedFiles: result.files,
    text: result.text,
    toolResults: result.toolResults,
    usage: result.usage,
    stepLimitReached:
      result.steps.length >= params.maxToolSteps &&
      result.steps.at(-1)?.finishReason === "tool-calls",
  };
}
