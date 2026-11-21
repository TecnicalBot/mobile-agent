import { describe, expect, it } from "vitest";
import type { ReasoningBlock } from "@/core/types/app-state";
import {
  closeReasoningPhases,
  updateReasoningPhase,
} from "@/modules/runtime/reasoning-stream";

describe("reasoning phases", () => {
  it("separates reused provider IDs around tools and anchors each phase once", () => {
    const blocks: ReasoningBlock[] = [];
    const active = new Map<string, ReasoningBlock>();
    let order = 0;
    const send = (kind: string, textOffset: number, text?: string) => updateReasoningPhase(
      blocks, active, { id: "reasoning-0", kind, textOffset, text }, () => order++, "2026-10-19T10:00:00Z",
    );
    send("reasoning-start", 0);
    send("reasoning-delta", 0, "First phase");
    send("reasoning-end", 0);
    order++; // intervening tool
    send("reasoning-start", 15);
    send("reasoning-delta", 20, "Second phase");
    send("reasoning-end", 20);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.text)).toEqual(["First phase", "Second phase"]);
    expect(blocks.map((block) => block.textOffset)).toEqual([0, 15]);
    expect(blocks.map((block) => block.traceOrder)).toEqual([0, 2]);
    expect(blocks[0].id).not.toBe(blocks[1].id);
  });

  it("closes an active thought at a text or tool boundary", () => {
    const blocks: ReasoningBlock[] = [];
    const active = new Map<string, ReasoningBlock>();
    updateReasoningPhase(
      blocks,
      active,
      { id: "reasoning-0", kind: "reasoning-delta", text: "Planning", textOffset: 0 },
      () => 0,
      "2026-10-19T10:00:00Z",
    );

    expect(closeReasoningPhases(active, "2026-10-19T10:00:02Z")).toBe(true);
    expect(blocks[0].completedAt).toBe("2026-10-19T10:00:02Z");
    // Already closed: the next delta starts a new phase instead of extending it.
    updateReasoningPhase(
      blocks,
      active,
      { id: "reasoning-0", kind: "reasoning-delta", text: "Again", textOffset: 0 },
      () => 1,
      "2026-10-19T10:00:03Z",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1].completedAt).toBeNull();
  });

  it("accepts a delta without a start, and duplicate end events do not create another phase", () => {
    const blocks: ReasoningBlock[] = [];
    const active = new Map<string, ReasoningBlock>();
    let order = 0;
    for (const kind of ["reasoning-delta", "reasoning-end", "reasoning-end"]) {
      updateReasoningPhase(blocks, active, { id: "a", kind, text: "Thinking", textOffset: 0 }, () => order++);
    }
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("Thinking");
    expect(order).toBe(1);
  });
});
