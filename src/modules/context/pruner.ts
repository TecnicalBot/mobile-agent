import type { ModelMessage } from "ai";

import { estimateMessageTokens } from "./token-estimator";

const PROTECT_RECENT_TURNS = 2;
const PRUNE_MINIMUM_FREE = 15_000;
const PRUNE_SIZE_THRESHOLD = 3_000;

type ContentPart = {
  type: string;
  text?: string;
  content?: string | { type: string; text?: string }[];
  result?: unknown;
  toolCallId?: string;
  toolName?: string;
};

function getPartPrunableLength(part: ContentPart): number {
  if (part.type === "text" && typeof part.text === "string") {
    return part.text.length;
  }
  if (part.type === "tool-result") {
    if (typeof part.content === "string") {
      return part.content.length;
    }
    if (Array.isArray(part.content)) {
      return part.content.reduce((sum, inner) => {
        return (
          sum +
          (typeof inner === "object" && inner && typeof inner.text === "string"
            ? inner.text.length
            : 0)
        );
      }, 0);
    }
    if (part.result !== undefined && part.result !== null) {
      return typeof part.result === "string"
        ? part.result.length
        : JSON.stringify(part.result).length;
    }
  }
  return 0;
}

function getMessagePrunableLength(message: ModelMessage): number {
  if (typeof message.content === "string") {
    return message.content.length;
  }
  if (Array.isArray(message.content)) {
    return (message.content as ContentPart[]).reduce(
      (sum, part) => sum + getPartPrunableLength(part),
      0,
    );
  }
  return 0;
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
    const hasLargePart = parts.some(
      (part) => getPartPrunableLength(part) > PRUNE_SIZE_THRESHOLD * 2,
    );

    if (hasLargePart) {
      const newContent = parts.map((part) => {
        if (getPartPrunableLength(part) > PRUNE_SIZE_THRESHOLD * 2) {
          if (part.type === "tool-result") {
            return {
              ...part,
              content: placeholder,
              result: placeholder,
            };
          }
          if (part.type === "text" && typeof part.text === "string") {
            return { ...part, text: placeholder };
          }
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
    const prunableLength = getMessagePrunableLength(msg);
    if (prunableLength > PRUNE_SIZE_THRESHOLD * 2) {
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

    const prunableLength = getMessagePrunableLength(msg);
    if (prunableLength <= PRUNE_SIZE_THRESHOLD * 2) {
      return msg;
    }

    const tokens = estimateMessageTokens(msg);
    return replaceContentWithPlaceholder(msg, tokens);
  });

  return pruned;
}
