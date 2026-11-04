import { describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "@/core/types/app-state";
import { compactHistory } from "../manual-compaction";
import { applyStoredCompaction } from "../stored-compaction";
import { createSummaryMessage } from "../summarizer";
import { estimateMessageTokens } from "../token-estimator";

describe("manual compaction", () => {
  it("summarizes proactively even when the history is not full", async () => {
    const generateSummary = vi.fn(async (_prompt: string) => "## Objective\n- Build an app");
    expect(await compactHistory({
      messages: [{ role: "user", content: "Build an app" }],
      inputBudget: 8000, generateSummary,
    })).toContain("Build an app");
    expect(generateSummary.mock.calls[0][0]).toContain("## Work State");
    expect(generateSummary.mock.calls[0][0]).toContain("## Relevant Files");
  });

  it("splits oversized history into bounded requests and carries the summary forward", async () => {
    const prompts: string[] = [];
    const generateSummary = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return "summary so far";
    });
    await compactHistory({ messages: [{ role: "user", content: "x".repeat(60_000) }], inputBudget: 3000, generateSummary });
    expect(prompts.length).toBeGreaterThan(1);
    for (const prompt of prompts) {
      expect(estimateMessageTokens({ role: "user", content: prompt })).toBeLessThan(3000);
    }
    expect(prompts[1]).toContain("<previous-summary>\nsummary so far");
  });

  it("reuses a previous checkpoint when compacting again", async () => {
    const generateSummary = vi.fn(async (_prompt: string) => "updated");
    await compactHistory({
      messages: [createSummaryMessage("existing decisions"), { role: "user", content: "new task" }],
      inputBudget: 8000, generateSummary,
    });
    expect(generateSummary.mock.calls[0][0]).toContain("<previous-summary>\nexisting decisions");
  });

  it("fails safely without history or without a summary", async () => {
    await expect(compactHistory({ messages: [], inputBudget: 8000, generateSummary: async () => "" })).rejects.toThrow("no conversation history");
    await expect(compactHistory({ messages: [{ role: "user", content: "hi" }], inputBudget: 8000, generateSummary: async () => "" })).rejects.toThrow("not been changed");
  });
});

function stored(id: string, sequence: number, metadata: StoredMessage["metadata"] = null): StoredMessage {
  return { id, sequence, metadata, content: id, role: "assistant", status: "completed" } as StoredMessage;
}

describe("stored compaction checkpoint", () => {
  it("replaces only model input, preserving the original transcript", () => {
    const messages = [stored("old", 1), stored("/compact", 2), stored("done", 3, {
      contextCompaction: { summary: "decisions", throughSequence: 2 },
    }), stored("new question", 4)];
    const result = applyStoredCompaction(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ role: "system" });
    expect(result[0].content).toContain("decisions");
    expect(result[1]).toBe(messages[3]);
    expect(messages).toHaveLength(4);
    expect(messages[0].content).toBe("old");
  });

  it("uses the latest successful checkpoint, never a failed one", () => {
    const first = stored("first", 2, { contextCompaction: { summary: "one", throughSequence: 1 } });
    const second = stored("second", 4, { contextCompaction: { summary: "two", throughSequence: 3 } });
    const failed = { ...stored("failed", 6, { contextCompaction: { summary: "bad", throughSequence: 5 } }), status: "failed" as const };
    expect(applyStoredCompaction([first, second, failed])[0].content).toContain("two");
  });
});
