import { describe, expect, it } from "vitest";
import type { ReasoningBlock, ToolExecutionRecord } from "@/core/types/app-state";
import { buildAssistantParts, type AssistantPart } from "../assistant-parts";
import {
  groupAssistantParts,
  toolTraceGroupTitle,
} from "../tool-trace-groups";

const thought = (id: string, order: number): ReasoningBlock => ({
  id,
  traceOrder: order,
  textOffset: 0,
  text: id,
  startedAt: "2026-10-19T10:00:00.000Z",
  completedAt: "2026-10-19T10:00:01.000Z",
});

const tool = (
  id: string,
  order: number,
  toolName = "shell",
  status: ToolExecutionRecord["status"] = "completed",
  extra: Partial<ToolExecutionRecord> = {},
): ToolExecutionRecord => ({
  id,
  traceOrder: order,
  toolName,
  status,
  inputSummary: "{}",
  outputSummary: null,
  error: null,
  createdAt: "2026-10-19T10:00:00.000Z",
  ...extra,
});

const partsFor = (tools: ToolExecutionRecord[], reasoning: ReasoningBlock[] = []) =>
  buildAssistantParts("Answer", {
    toolExecutions: tools,
    reasoning,
    toolRunAnchors: tools.map((record) => ({ executionId: record.id!, textOffset: 0 })),
  });

/** The first group's records, or a clear test failure when nothing grouped. */
const firstGroup = (parts: AssistantPart[]) => {
  const group = groupAssistantParts(parts)[0];
  if (group.kind !== "tool-group") throw new Error("expected a tool group");
  return group.parts;
};

describe("tool trace groups", () => {
  it("folds adjacent completed calls of one tool into one row", () => {
    const grouped = groupAssistantParts(
      partsFor([tool("a", 0), tool("b", 1), tool("c", 2), tool("d", 3)]),
    );
    expect(grouped.map((part) => part.kind)).toEqual(["tool-group", "text"]);
    expect(toolTraceGroupTitle(firstGroup(partsFor([tool("a", 0), tool("b", 1), tool("c", 2), tool("d", 3)])))).toBe(
      "Ran 4 commands",
    );
  });

  it("does not group across reasoning or text boundaries", () => {
    const grouped = groupAssistantParts(
      partsFor(
        [tool("a", 0), tool("b", 2), tool("c", 4)],
        [thought("think-1", 1), thought("think-2", 3)],
      ),
    );
    expect(grouped.map((part) => part.kind)).toEqual([
      "tool",
      "reasoning",
      "tool",
      "reasoning",
      "tool",
      "text",
    ]);
  });

  it("never hides running or failed calls inside a group", () => {
    const grouped = groupAssistantParts(
      partsFor([
        tool("a", 0),
        tool("b", 1, "shell", "running"),
        tool("c", 2),
        tool("d", 3, "shell", "failed", { error: "boom" }),
      ]),
    );
    expect(grouped.map((part) => part.kind)).toEqual([
      "tool",
      "tool",
      "tool",
      "tool",
      "text",
    ]);
  });

  it("does not mix different tools in one group", () => {
    const grouped = groupAssistantParts(
      partsFor([
        tool("a", 0, "shell"),
        tool("b", 1, "read"),
        tool("c", 2, "read"),
        tool("d", 3, "shell"),
      ]),
    );
    expect(grouped.map((part) => part.kind)).toEqual(["tool", "tool-group", "tool", "text"]);
  });

  it("uses a natural label for known tools and falls back for the rest", () => {
    expect(
      toolTraceGroupTitle(firstGroup(partsFor([tool("a", 0, "read"), tool("b", 1, "read")]))),
    ).toBe("Read 2 files");
    expect(
      toolTraceGroupTitle(
        firstGroup(partsFor([tool("a", 0, "mystery"), tool("b", 1, "mystery")])),
      ),
    ).toBe("Used Mystery 2 times");
  });
});
