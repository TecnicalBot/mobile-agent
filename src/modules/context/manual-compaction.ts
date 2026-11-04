import type { ModelMessage } from "ai";

import { buildSummaryPrompt, findPreviousSummary, serializeForSummary } from "./summarizer";
import { estimateMessageTokens } from "./token-estimator";

/** Summarize in bounded requests so /compact also works on oversized history. */
export async function compactHistory(input: {
  messages: ModelMessage[];
  inputBudget: number;
  generateSummary: (prompt: string) => Promise<string | undefined>;
}): Promise<string> {
  const previous = findPreviousSummary(input.messages);
  const history = serializeForSummary(input.messages.filter((_, index) => index !== previous?.index));
  if (!history.trim() && previous) return previous.summary;
  if (!history.trim()) throw new Error("There is no conversation history to compact yet.");
  let summary: string | undefined = previous?.summary;
  let offset = 0;
  while (offset < history.length) {
    const overhead = estimateMessageTokens({ role: "user", content: buildSummaryPrompt({ previousSummary: summary, history: "" }) });
    const available = Math.floor(input.inputBudget - overhead - 128);
    if (available <= 0) throw new Error("The summary exceeds this model's context budget. Select a model with a larger context window.");
    const chunk = history.slice(offset, offset + available * 4);
    const next = (await input.generateSummary(buildSummaryPrompt({ previousSummary: summary, history: chunk })))?.trim();
    if (!next) throw new Error("The model did not return a summary. Your conversation has not been changed.");
    summary = next;
    offset += chunk.length;
  }
  if (estimateMessageTokens({ role: "system", content: summary! }) >= input.inputBudget) {
    throw new Error("The generated summary is too large for this model's context window.");
  }
  return summary!;
}
