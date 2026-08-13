import { describe, expect, it } from "vitest";

import { selectTail } from "../tail";
import { estimateMessageTokens } from "../token-estimator";
import { msg } from "./test-fixtures";

function turn(user: string, assistant?: string) {
  return [
    msg("user", user.padEnd(100, "x")),
    ...(assistant ? [msg("assistant", assistant.padEnd(100, "x"))] : []),
  ];
}

const estimate = estimateMessageTokens;

describe("selectTail", () => {
  it("keeps the last two turns by default", () => {
    const messages = [...turn("u0", "a0"), ...turn("u1", "a1"), ...turn("u2", "a2")];
    const result = selectTail({ messages, estimate });
    expect(result).toEqual({ tailStartIndex: 2 });
  });

  it("keeps only the configured number of turns", () => {
    const messages = [...turn("u0", "a0"), ...turn("u1", "a1"), ...turn("u2", "a2")];
    const result = selectTail({ messages, tailTurns: 1, estimate });
    expect(result).toEqual({ tailStartIndex: 4 });
  });

  it("returns no tail when tailTurns is zero", () => {
    const messages = [...turn("u0", "a0"), ...turn("u1", "a1")];
    expect(selectTail({ messages, tailTurns: 0, estimate })).toEqual({
      tailStartIndex: 0,
    });
  });

  it("respects the preserve-token budget", () => {
    const messages = [...turn("u0", "a0"), ...turn("u1", "a1"), ...turn("u2", "a2")];
    // each turn is 2 messages (~58 tokens); budget fits 1.5 turns
    const result = selectTail({
      messages,
      preserveRecentTokens: 100,
      estimate,
    });
    expect(result?.tailStartIndex).toBe(3);
  });

  it("splits an oversized turn to fit the remaining budget", () => {
    const messages = [
      msg("user", "u"),
      msg("assistant", "h".repeat(5000)),
      msg("assistant", "x".repeat(100)),
    ];
    const result = selectTail({
      messages,
      preserveRecentTokens: 1254,
      estimate,
    });
    // only the last assistant message fits in the budget
    expect(result?.tailStartIndex).toBe(2);
  });

  it("returns undefined when there are no user turns", () => {
    const messages = [msg("assistant", "a"), msg("assistant", "b")];
    expect(selectTail({ messages, estimate })).toBeUndefined();
  });

  it("returns undefined for an empty message list", () => {
    expect(selectTail({ messages: [], estimate })).toBeUndefined();
  });
});
