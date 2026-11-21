import { describe, expect, it } from "vitest";

import type { ReasoningBlock } from "@/core/types/app-state";
import { closeReasoningPhases } from "@/modules/runtime/reasoning-stream";

function block(id: string, completedAt: string | null): ReasoningBlock {
  return {
    id,
    text: "Thinking",
    textOffset: 0,
    startedAt: "2026-11-21T10:00:00.000Z",
    completedAt,
  };
}

describe("closeReasoningPhases", () => {
  it("closes open phases when text or a tool supersedes them", () => {
    const active = new Map([
      ["a", block("a", null)],
      ["b", block("b", "2026-11-21T10:00:01.000Z")],
    ]);

    expect(closeReasoningPhases(active, "2026-11-21T10:00:02.000Z")).toBe(true);
    expect(active.get("a")?.completedAt).toBe("2026-11-21T10:00:02.000Z");
    expect(active.get("b")?.completedAt).toBe("2026-11-21T10:00:01.000Z");
    expect(closeReasoningPhases(active, "2026-11-21T10:00:03.000Z")).toBe(false);
  });
});
