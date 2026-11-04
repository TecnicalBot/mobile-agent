import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { safeTailStart } from "../message-boundaries";
import { truncateMessages } from "../compaction";

const messages: ModelMessage[] = [
  { role: "user", content: "old history".repeat(100) },
  { role: "assistant", content: [
    { type: "tool-call", toolCallId: "a", toolName: "read", input: {} },
    { type: "tool-call", toolCallId: "b", toolName: "read", input: {} },
  ] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "read", output: { type: "text", value: "first" } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "b", toolName: "read", output: { type: "text", value: "second" } }] },
  { role: "assistant", content: "done" },
];

describe("safe compaction boundaries", () => {
  it("rewinds split parallel tool results to their calls", () => {
    expect(safeTailStart(messages, 2)).toBe(1);
    expect(safeTailStart(messages, 3)).toBe(1);
    expect(safeTailStart(messages, 4)).toBe(4);
  });

  it("does not orphan recent tool results when truncating", () => {
    const result = truncateMessages(messages, 60);
    expect(result).toContain(messages[1]);
    expect(result).toContain(messages[2]);
    expect(result).toContain(messages[3]);
  });
});
