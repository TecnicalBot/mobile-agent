import type { ModelMessage } from "ai";

import { estimateMessageTokens } from "./token-estimator";

const PROTECT_RECENT_TURNS = 2;
const PRUNE_MINIMUM_FREE = 15_000;
const PRUNE_SIZE_THRESHOLD = 3_000;

type ContentPart = { type: string; text?: string };

function getMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return (message.content as ContentPart[])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text!)
      .join("\n");
  }
  return "";
}

function replaceContentWithPlaceholder(
  message: ModelMessage,
  originalTokens: number,
): ModelMessage {
  const placeholder = `[Tool output pruned — ~${originalTokens} tokens]`;

  if (typeof message.content === "string") {
    return { ...message, content: placeholder } as ModelMessage;
  }

  if (Array.isArray(message.content)) {
    const parts = message.content as ContentPart[];
    const hasLargeText = parts.some(
      (part) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.length > PRUNE_SIZE_THRESHOLD * 2,
    );

    if (hasLargeText) {
      const newContent = parts.map((part) => {
        if (
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text.length > PRUNE_SIZE_THRESHOLD * 2
        ) {
          return { ...part, text: placeholder };
        }
        return part;
      });
      return { ...message, content: newContent } as ModelMessage;
    }
  }

  return message;
}

export function pruneToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= PROTECT_RECENT_TURNS * 2) {
    return messages;
  }

  const protectFrom = Math.max(messages.length - PROTECT_RECENT_TURNS * 2, 0);
  const candidates = messages.slice(0, protectFrom);

  let totalPrunableTokens = 0;
  for (const msg of candidates) {
    const text = getMessageText(msg);
    if (text.length > PRUNE_SIZE_THRESHOLD * 2) {
      totalPrunableTokens += estimateMessageTokens(msg);
    }
  }

  if (totalPrunableTokens < PRUNE_MINIMUM_FREE) {
    return messages;
  }

  const pruned = messages.map((msg, index) => {
    if (index >= protectFrom) {
      return msg;
    }

    const text = getMessageText(msg);
    if (text.length <= PRUNE_SIZE_THRESHOLD * 2) {
      return msg;
    }

    const tokens = estimateMessageTokens(msg);
    return replaceContentWithPlaceholder(msg, tokens);
  });

  return pruned;
}
