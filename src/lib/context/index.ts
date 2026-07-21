import type { ModelMessage, ToolSet } from "ai";

import type { ResolvedModel } from "@/types/app-state";

import { truncateMessages } from "./compaction";
import {
  type ContextBudget,
  calculateContextBudget,
  isOverflow,
} from "./overflow";
import { pruneToolOutputs } from "./pruner";

export type { ContextBudget } from "./overflow";

export function prepareMessagesForLLM(input: {
  contextWindow?: number | null;
  messages: ModelMessage[];
  model: ResolvedModel;
  systemPrompt?: string;
  tools?: ToolSet;
}): { messages: ModelMessage[]; budget: ContextBudget; didPrune: boolean; didTruncate: boolean } {
  const budget = calculateContextBudget({
    contextWindow: input.contextWindow,
    model: input.model,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
  });

  let messages = input.messages;
  let didPrune = false;
  let didTruncate = false;

  if (!isOverflow(messages, budget)) {
    return { messages, budget, didPrune: false, didTruncate: false };
  }

  const pruned = pruneToolOutputs(messages);
  if (pruned !== messages) {
    didPrune = true;
    messages = pruned;
  }

  if (!isOverflow(messages, budget)) {
    return { messages, budget, didPrune, didTruncate: false };
  }

  const truncated = truncateMessages(messages, budget.usable);
  if (truncated !== messages) {
    didTruncate = true;
    messages = truncated;
  }

  return { messages, budget, didPrune, didTruncate };
}

export { isOverflow } from "./overflow";
export { pruneToolOutputs } from "./pruner";
export { truncateMessages } from "./compaction";
