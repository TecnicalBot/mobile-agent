import type { StoredMessage } from "@/core/types/app-state";
import { createSummaryMessage } from "./summarizer";

/** A checkpoint changes model input only; the original transcript stays intact. */
export function applyStoredCompaction(messages: StoredMessage[]): StoredMessage[] {
  const checkpoint = messages.findLast((message) =>
    message.role === "assistant" && message.status === "completed" &&
    message.metadata?.contextCompaction?.summary.trim(),
  );
  const compaction = checkpoint?.metadata?.contextCompaction;
  if (!checkpoint || !compaction) return messages;
  return [
    { ...checkpoint, role: "system", content: String(createSummaryMessage(compaction.summary).content), metadata: null },
    ...messages.filter((message) => message.sequence > compaction.throughSequence && message.id !== checkpoint.id),
  ];
}
