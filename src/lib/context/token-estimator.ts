import type { ModelMessage } from "ai";

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_ESTIMATE = 1000;
const REASONING_CHARS_PER_TOKEN = 3;

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateContentArrayTokens(
  parts: { type: string; text?: string; content?: string | { type: string; text?: string }[] }[],
): number {
  let tokens = 0;
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      tokens += estimateTextTokens(part.text);
    } else if (part.type === "reasoning" && typeof part.text === "string") {
      tokens += Math.ceil(part.text.length / REASONING_CHARS_PER_TOKEN);
    } else if (part.type === "file" || part.type === "image") {
      tokens += IMAGE_TOKEN_ESTIMATE;
    } else if (part.type === "tool-result" && typeof part.content === "string") {
      tokens += estimateTextTokens(part.content);
    } else if (part.type === "tool-result" && Array.isArray(part.content)) {
      for (const inner of part.content) {
        if (typeof inner === "object" && inner !== null && typeof inner.text === "string") {
          tokens += estimateTextTokens(inner.text);
        }
      }
    }
  }
  return tokens;
}

export function estimateTokens(content: string): number {
  return estimateTextTokens(content);
}

export function estimateMessageTokens(message: ModelMessage): number {
  const overhead = 4;
  let contentTokens = 0;

  if (typeof message.content === "string") {
    contentTokens = estimateTextTokens(message.content);
  } else if (Array.isArray(message.content)) {
    contentTokens = estimateContentArrayTokens(
      message.content as { type: string; text?: string; content?: string | { type: string; text?: string }[] }[],
    );
  }

  return overhead + contentTokens;
}

export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}
