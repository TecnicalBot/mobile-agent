import { describe, expect, it } from "vitest";
import type { ReasoningBlock, ToolExecutionRecord } from "@/core/types/app-state";
import { buildAssistantParts } from "../assistant-parts";

const thought = (id: string, order: number, offset = 0): ReasoningBlock => ({
  id, traceOrder: order, textOffset: offset, text: id,
  startedAt: "2026-10-19T10:00:00.000Z", completedAt: "2026-10-19T10:00:01.000Z",
});
const tool = (id: string, order?: number): ToolExecutionRecord => ({
  id, traceOrder: order, toolName: "read", status: "completed", inputSummary: "{}",
  outputSummary: null, error: null, createdAt: "2026-10-19T10:00:00.000Z",
});

describe("assistant stream parts", () => {
  it("interleaves repeated thinking and tools at the same offset, even with equal timestamps", () => {
    const parts = buildAssistantParts("Answer", {
      reasoning: [thought("first", 0), thought("second", 2)],
      toolExecutions: [tool("read", 1), tool("edit", 3)],
      toolRunAnchors: [{ executionId: "read", textOffset: 0 }, { executionId: "edit", textOffset: 0 }],
    });
    expect(parts.map((part) => part.kind)).toEqual(["reasoning", "tool", "reasoning", "tool", "text"]);
  });

  it("preserves commentary between tool phases without losing or duplicating characters", () => {
    const content = "Looking.Editing.Done.";
    const parts = buildAssistantParts(content, {
      reasoning: [thought("first", 0), thought("second", 2, 8)],
      toolExecutions: [tool("read", 1), tool("edit", 3)],
      toolRunAnchors: [{ executionId: "read", textOffset: 8 }, { executionId: "edit", textOffset: 16 }],
    });
    expect(parts.map((part) => part.kind)).toEqual(["reasoning", "text", "tool", "reasoning", "text", "tool", "text"]);
    expect(parts.flatMap((part) => part.kind === "text" ? [part.text] : []).join("")).toBe(content);
    expect(new Set(parts.map((part) => part.key)).size).toBe(parts.length);
  });

  it("places legacy activity before the answer in timestamp order", () => {
    const early = { ...thought("first", 0), traceOrder: undefined, textOffset: undefined };
    const later = { ...tool("read"), createdAt: "2026-10-19T10:00:02.000Z" };
    const parts = buildAssistantParts("Old answer", { reasoning: [early], toolExecutions: [later] });
    expect(parts.map((part) => part.kind)).toEqual(["reasoning", "tool", "text"]);
  });

  it("merges legacy Termux anchors with newer tool anchors, preferring the newer offset", () => {
    const parts = buildAssistantParts("BeforeAfter", {
      toolExecutions: [tool("command", 0)],
      termuxRunAnchors: [{ executionId: "command", textOffset: 0 }],
      toolRunAnchors: [{ executionId: "command", textOffset: 6 }],
    });
    expect(parts[0]).toMatchObject({ kind: "text", text: "Before" });
    expect(parts[2]).toMatchObject({ kind: "text", text: "After" });
  });

  it("does not lose content with invalid or regressing offsets", () => {
    for (const offset of [-2, NaN, 1000, 1.5]) {
      const parts = buildAssistantParts("Answer", { toolExecutions: [tool("bad", 0)], toolRunAnchors: [{ executionId: "bad", textOffset: offset }] });
      expect(parts.map((part) => part.kind)).toEqual(["tool", "text"]);
    }
  });

  it("keeps keys stable as a running tool completes and the final answer arrives", () => {
    const record = tool("read", 0);
    const first = buildAssistantParts("", { toolExecutions: [{ ...record, status: "running" }] });
    const second = buildAssistantParts("Done", { toolExecutions: [record] });
    expect(first[0].key).toBe(second[0].key);
  });

  it("does not remount existing media or code when a tool arrives after it", () => {
    const content = "![Image](workspace://image)\n\n```html\n<h1>Preview</h1>\n```\n";
    const before = buildAssistantParts(content);
    const during = buildAssistantParts(content, {
      toolExecutions: [{ ...tool("next", 0), status: "running" }],
      toolRunAnchors: [{ executionId: "next", textOffset: content.length }],
    });
    const after = buildAssistantParts(`${content}Done`, {
      toolExecutions: [tool("next", 0)],
      toolRunAnchors: [{ executionId: "next", textOffset: content.length }],
    });
    expect(during[0]).toEqual(before[0]);
    expect(after[0]).toEqual(before[0]);
    expect(after.map((part) => part.kind)).toEqual(["text", "tool", "text"]);
  });

  it("keeps each completed text segment mounted across subsequent thinking and tools", () => {
    const first = buildAssistantParts("BeforeAfter", {
      toolExecutions: [tool("first", 0)],
      toolRunAnchors: [{ executionId: "first", textOffset: 6 }],
    });
    const next = buildAssistantParts("BeforeAfterFinal", {
      toolExecutions: [tool("first", 0), tool("second", 2)],
      reasoning: [thought("thinking", 1, 11)],
      toolRunAnchors: [
        { executionId: "first", textOffset: 6 },
        { executionId: "second", textOffset: 11 },
      ],
    });
    expect(next[0]).toEqual(first[0]);
    expect(next[2]).toEqual(first[2]);
    expect(new Set(next.map((part) => part.key)).size).toBe(next.length);
  });

  it("keeps reasoning identity when an earlier empty step is filtered out", () => {
    const empty = { ...thought("empty", 0), text: "", completedAt: null };
    const visible = thought("visible", 1);
    const before = buildAssistantParts("", { reasoning: [empty, visible] });
    const after = buildAssistantParts("", {
      reasoning: [{ ...empty, completedAt: visible.completedAt }, visible],
    });
    expect(after[0]).toEqual(before[1]);
  });

  it("keeps distinct legacy calls without IDs or distinct timestamps", () => {
    const parts = buildAssistantParts("Done", { toolExecutions: [{ ...tool("a"), id: undefined }, { ...tool("b"), id: undefined }] });
    expect(new Set(parts.map((part) => part.key)).size).toBe(3);
  });
});
