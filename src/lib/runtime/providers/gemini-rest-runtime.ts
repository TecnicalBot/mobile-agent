import type { ModelMessage } from "ai";

import type { GenerateModelTextStreamParams } from "@/lib/runtime/providers/types";

type GeminiContent = {
  parts: Array<{ text: string }>;
  role?: "user" | "model";
};

function getMessageTextContent(message: ModelMessage) {
  if (typeof message.content === "string") {
    return message.content;
  }

  const parts = message.content
    .filter(
      (part): part is Extract<typeof part, { type: "text"; text: string }> =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text.trim())
    .filter(Boolean);

  return parts.join("\n\n");
}

function mapMessagesToGeminiContents(messages: ModelMessage[]) {
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    const text = getMessageTextContent(message).trim();

    if (!text) {
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }

  return contents;
}

function extractGeminiText(response: any): string {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const parts = candidates.flatMap((candidate: any) =>
    Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
  );
  const text = parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");

  if (text) {
    return text;
  }

  const blockReason = response?.promptFeedback?.blockReason;

  if (blockReason) {
    throw new Error(`Gemini blocked the prompt: ${blockReason}.`);
  }

  throw new Error("Gemini returned no text output.");
}

export async function generateViaGeminiREST(
  apiKey: string,
  params: GenerateModelTextStreamParams,
) {
  if (params.tools && Object.keys(params.tools).length > 0) {
    throw new Error(
      "Native Gemini REST mode does not support file tools yet. Switch to OpenAI-compatible, OpenAI API, Anthropic, or OpenRouter for agent file actions.",
    );
  }

  const baseUrl =
    params.provider.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(
    params.model.modelId,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = mapMessagesToGeminiContents(params.messages);

  if (contents.length === 0) {
    throw new Error("Gemini request is missing message content.");
  }

  const body: Record<string, unknown> = {
    contents,
  };

  if (params.system?.trim()) {
    body.system_instruction = {
      parts: [{ text: params.system.trim() }],
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `Gemini request failed with status ${response.status}.`;

    throw new Error(message);
  }

  const finalText = extractGeminiText(payload);
  params.onDelta?.(finalText);
  return finalText;
}
