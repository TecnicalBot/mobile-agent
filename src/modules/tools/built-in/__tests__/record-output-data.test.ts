import { describe, expect, it } from "vitest";
import { createRecord, TOOL_OUTPUT_DATA_LIMIT } from "../shared";

describe("structured trace output", () => {
  it("stores the full result so a tool-specific card can render it", () => {
    const items = [
      { status: "completed", title: "Plan" },
      { status: "in_progress", title: "Build" },
    ];
    const record = createRecord({
      toolName: "todos",
      status: "completed",
      inputSummary: '{"count":2}',
      outputData: { count: 2, items },
    });

    expect(record.outputData).toEqual({ count: 2, items });
  });

  it("drops oversized results instead of bloating message metadata", () => {
    const record = createRecord({
      toolName: "fetchPage",
      status: "completed",
      inputSummary: "{}",
      outputData: { text: "x".repeat(TOOL_OUTPUT_DATA_LIMIT) },
    });

    expect(record.outputData).toBeUndefined();
  });

  it("keeps structured data for every status", () => {
    const record = createRecord({
      toolName: "todos",
      status: "running",
      inputSummary: "{}",
      outputData: { count: 0, items: [] },
    });

    expect("outputData" in record).toBe(true);
    expect(record.outputData).toEqual({ count: 0, items: [] });
  });
});
