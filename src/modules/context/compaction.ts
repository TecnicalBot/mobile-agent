import type { ModelMessage } from "ai";

import { estimateMessageTokens } from "./token-estimator";

const COMPACTION_MARKER =
  "[Earlier conversation was truncated to fit the model's context window.]";

function isSystemMessage(message: ModelMessage): boolean {
  return message.role === "system";
}

function createCompactionMarker(): ModelMessage {
  return {
    role: "user",
    content: COMPACTION_MARKER,
  } as ModelMessage;
}

export function truncateMessages(
  messages: ModelMessage[],
  budgetTokens: number,
): ModelMessage[] {
  if (messages.length === 0) return messages;

  const systemMessages: ModelMessage[] = [];
  const nonSystemMessages: ModelMessage[] = [];

  for (const message of messages) {
    if (isSystemMessage(message)) {
      systemMessages.push(message);
    } else {
      nonSystemMessages.push(message);
    }
  }

  if (nonSystemMessages.length === 0) return messages;

  const systemTokens = systemMessages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

  const remainingBudget = Math.max(budgetTokens - systemTokens, 0);

  if (nonSystemMessages.length <= 2) {
    return messages;
  }

  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]!;
  const secondLastMessage =
    nonSystemMessages.length >= 2
      ? nonSystemMessages[nonSystemMessages.length - 2]
      : null;

  const tailTokens =
    estimateMessageTokens(lastMessage) +
    (secondLastMessage ? estimateMessageTokens(secondLastMessage) : 0);

  if (tailTokens >= remainingBudget) {
    return [
      ...systemMessages,
      createCompactionMarker(),
      secondLastMessage!,
      lastMessage,
    ];
  }

  let keptTokens = tailTokens;
  const keptMessages: ModelMessage[] = [lastMessage];

  if (secondLastMessage) {
    keptMessages.unshift(secondLastMessage);
  }

  for (let i = nonSystemMessages.length - 3; i >= 0; i--) {
    const msg = nonSystemMessages[i]!;
    const msgTokens = estimateMessageTokens(msg);

    if (keptTokens + msgTokens > remainingBudget) {
      break;
    }

    keptTokens += msgTokens;
    keptMessages.unshift(msg);
  }

  const droppedCount = nonSystemMessages.length - keptMessages.length;

  if (droppedCount === 0) {
    return messages;
  }

  return [...systemMessages, createCompactionMarker(), ...keptMessages];
}
