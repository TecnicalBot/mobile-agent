import type { ModelMessage, ToolSet } from "ai";

import type { ResolvedModel } from "@/core/types/app-state";

import { truncateMessages } from "./compaction";
import { safeTailStart } from "./message-boundaries";
import { compactHistory } from "./manual-compaction";
import {
  type ContextBudget,
  calculateContextBudget,
  isOverflow,
} from "./overflow";
import { pruneToolOutputs } from "./pruner";
import { createSummaryMessage } from "./summarizer";
import { selectTail } from "./tail";
import { estimateMessageTokens } from "./token-estimator";

export type { ContextBudget } from "./overflow";

export type GenerateSummary = (prompt: string) => Promise<string | undefined>;

export type SummaryResult = {
  messages: ModelMessage[];
  budget: ContextBudget;
  didPrune: boolean;
  didTruncate: boolean;
  didSummarize: boolean;
  summaryText?: string;
};

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

async function summarizeConversation(input: {
  inputBudget: number;
  generateSummary: GenerateSummary;
  messages: ModelMessage[];
  tailStartIndex: number;
}): Promise<{ messages: ModelMessage[]; summary: string } | undefined> {
  const head = input.messages.slice(0, input.tailStartIndex);
  const tail = input.messages.slice(input.tailStartIndex);
  if (head.length === 0) return undefined;

  let summary: string | undefined;
  try {
    summary = await compactHistory({
      messages: head,
      inputBudget: input.inputBudget,
      generateSummary: input.generateSummary,
    });
  } catch {
    summary = undefined;
  }

  const clean = summary?.trim();
  if (!clean) return undefined;

  return {
    summary: clean,
    messages: [createSummaryMessage(clean), ...tail],
  };
}

export async function prepareMessagesForLLMWithSummary(input: {
  contextWindow?: number | null;
  messages: ModelMessage[];
  model: ResolvedModel;
  systemPrompt?: string;
  tools?: ToolSet;
  generateSummary?: GenerateSummary;
  tailTurns?: number;
  preserveRecentTokens?: number;
}): Promise<SummaryResult> {
  const budget = calculateContextBudget({
    contextWindow: input.contextWindow,
    model: input.model,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
  });

  let messages = input.messages;
  let didPrune = false;
  let didTruncate = false;
  let didSummarize = false;
  let summaryText: string | undefined;

  if (!isOverflow(messages, budget)) {
    return { messages, budget, didPrune: false, didTruncate: false, didSummarize: false };
  }

  const pruned = pruneToolOutputs(messages);
  if (pruned !== messages) {
    didPrune = true;
    messages = pruned;
  }

  if (!isOverflow(messages, budget)) {
    return { messages, budget, didPrune, didTruncate: false, didSummarize: false };
  }

  if (input.generateSummary) {
    const preserveRecentTokens =
      input.preserveRecentTokens ??
      Math.min(8_000, Math.max(2_000, Math.floor(budget.usable * 0.25)));
    const selection = selectTail({
      messages,
      tailTurns: input.tailTurns,
      preserveRecentTokens,
      estimate: estimateMessageTokens,
    });

    const summarized = await summarizeConversation({
      inputBudget: budget.contextWindow - budget.reserved,
      generateSummary: input.generateSummary,
      messages,
      tailStartIndex: safeTailStart(messages, selection?.tailStartIndex ?? 0),
    });

    if (summarized) {
      didSummarize = true;
      summaryText = summarized.summary;
      messages = summarized.messages;

      if (!isOverflow(messages, budget)) {
        return { messages, budget, didPrune, didTruncate: false, didSummarize, summaryText };
      }
    }
  }

  const truncated = truncateMessages(messages, budget.usable);
  if (truncated !== messages) {
    didTruncate = true;
    messages = truncated;
  }

  return { messages, budget, didPrune, didTruncate, didSummarize, summaryText };
}

export { isOverflow } from "./overflow";
export { pruneToolOutputs } from "./pruner";
export { truncateMessages } from "./compaction";
export { selectTail } from "./tail";
export {
  buildSummaryPrompt,
  createSummaryMessage,
  findPreviousSummary,
  serializeForSummary,
} from "./summarizer";
