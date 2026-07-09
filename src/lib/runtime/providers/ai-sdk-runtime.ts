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

export async function generateViaAISDK(
  providerModel: ProviderLanguageModel,
  params: GenerateModelTextStreamParams,
) {
  try {
    const result = streamText({
      abortSignal: params.abortSignal,
      model: providerModel,
      messages: params.messages,
      providerOptions: params.providerOptions as any,
      stopWhen: stepCountIs(5),
      system: params.system,
      tools: params.tools,
    });

    let finalText = "";

    for await (const delta of result.textStream) {
      finalText += delta;
      params.onDelta?.(delta);
    }

    await result.text;
    const [files, toolResults, usage] = await Promise.all([
      result.files,
      result.toolResults,
      result.usage,
    ]);

    return {
      generatedFiles: files,
      text: finalText,
      toolResults,
      usage,
    };
  } catch (error) {
    if (params.abortSignal?.aborted) {
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
    stopWhen: stepCountIs(5),
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
  };
}
