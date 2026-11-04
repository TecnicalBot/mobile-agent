import { describe, expect, it } from "vitest";
import type { ContextCompactionRecord, StoredMessage } from "@/core/types/app-state";
import { describeCompaction, getCompactionHistory } from "./compaction-info";

function record(overrides: Partial<ContextCompactionRecord> = {}): ContextCompactionRecord {
  return {
    trigger: "automatic",
    createdAt: "2026-11-04T12:00:00Z",
    beforeTokens: 30_000,
    afterTokens: 5_000,
    inputBudget: 25_000,
    didPrune: false,
    didTruncate: false,
    summary: "## Objective\n- Build the app\n\n## Relevant Files\n- src/app.ts",
    ...overrides,
  };
}

function message(id: string, records?: ContextCompactionRecord[]): StoredMessage {
  return { id, metadata: records ? { contextCompactions: records } : null } as StoredMessage;
}

describe("compaction details", () => {
  it("exposes the complete saved summary and metrics without modifying history", () => {
    const original = record({ summary: "full summary\n".repeat(2000) });
    const messages = [message("one", [original])];
    expect(getCompactionHistory(messages)).toEqual([{ ...original, id: "one:0" }]);
    expect(messages[0].metadata?.contextCompactions?.[0]).toBe(original);
  });

  it("shows automatic and manual events newest first, including repeated compactions", () => {
    const messages = [
      message("one", [record(), record({ didPrune: true })]),
      message("two"),
      message("three", [record({ trigger: "manual" })]),
    ];
    expect(getCompactionHistory(messages).map(({ id }) => id)).toEqual(["three:0", "one:1", "one:0"]);
    expect(getCompactionHistory(messages)[0].trigger).toBe("manual");
  });

  it("distinguishes summary generation from pruning and fallback truncation", () => {
    expect(describeCompaction(record())).toBe("Summarized earlier messages");
    expect(describeCompaction(record({ summary: null, didPrune: true, didTruncate: true })))
      .toBe("Pruned older tool outputs · Dropped older messages to fit");
  });

  it("handles chats that have not compacted yet", () => {
    expect(getCompactionHistory([message("old")])).toEqual([]);
  });
});
