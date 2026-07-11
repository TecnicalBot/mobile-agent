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

export async function generateViaAISDK(
  providerModel: ProviderLanguageModel,
  params: GenerateModelTextStreamParams,
) {
  let finalText = "";

  try {
    const result = streamText({
      abortSignal: params.abortSignal,
      model: providerModel,
      messages: params.messages,
      providerOptions: params.providerOptions as any,
      stopWhen: stepCountIs(params.maxToolSteps),
      system: params.system,
      tools: params.tools,
    });

    for await (const delta of result.textStream) {
      finalText += delta;
      params.onDelta?.(delta);
    }

    await result.text;
    const [files, toolResults, usage, steps] = await Promise.all([
      result.files,
      result.toolResults,
      result.usage,
      result.steps,
    ]);

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
    model: providerModel,
    messages: params.messages,
    providerOptions: params.providerOptions as any,
    stopWhen: stepCountIs(params.maxToolSteps),
    system: params.system,
    tools: params.tools,
  });

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
