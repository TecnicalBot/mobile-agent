import type { ContextCompactionRecord, StoredMessage } from "@/core/types/app-state";

export function getCompactionHistory(messages: StoredMessage[]) {
  return messages.flatMap((message) =>
    (message.metadata?.contextCompactions ?? []).map((record, index) => ({
      ...record,
      id: `${message.id}:${index}`,
    })),
  ).reverse();
}

export function describeCompaction(record: ContextCompactionRecord) {
  return [
    record.summary ? "Summarized earlier messages" : null,
    record.didPrune ? "Pruned older tool outputs" : null,
    record.didTruncate ? "Dropped older messages to fit" : null,
  ].filter(Boolean).join(" · ");
}
