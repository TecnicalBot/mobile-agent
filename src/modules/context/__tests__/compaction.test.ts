import { describe, expect, it } from "vitest";

import { truncateMessages } from "../compaction";
import { estimateMessagesTokens } from "../token-estimator";
import { msg } from "./test-fixtures";

const MARKER =
  "[Earlier conversation was truncated to fit the model's context window.]";

function manyMessages(count: number, chars = 500) {
  const text = "m".repeat(chars);
  return Array.from({ length: count }, () => msg("user", text));
}

describe("truncateMessages", () => {
  it("returns messages unchanged for an empty list", () => {
    const messages: ReturnType<typeof msg>[] = [];
    expect(truncateMessages(messages, 1000)).toBe(messages);
  });

  it("returns messages unchanged when only system messages exist", () => {
    const messages = [msg("system", "sys"), msg("system", "sys2")];
    expect(truncateMessages(messages, 1000)).toBe(messages);
  });

  it("returns messages unchanged when there are two or fewer non-system messages", () => {
    const messages = [msg("user", "a"), msg("assistant", "b")];
    expect(truncateMessages(messages, 1000)).toBe(messages);
  });

  it("returns messages unchanged when everything fits the budget", () => {
    const messages = manyMessages(10, 100);
    expect(truncateMessages(messages, 10_000)).toBe(messages);
  });

  it("keeps system messages, inserts a marker, and keeps the tail", () => {
    const system = msg("system", "sys");
    const rest = manyMessages(20);
    const messages = [system, ...rest];

    const result = truncateMessages(messages, 1000);

    expect(result[0]).toBe(system);
    expect(result[1]!.role).toBe("user");
    expect(result[1]!.content).toBe(MARKER);
    expect(result).toHaveLength(9);

    const kept = result.slice(2);
    expect(kept[kept.length - 1]).toBe(rest[rest.length - 1]);
    expect(kept[kept.length - 2]).toBe(rest[rest.length - 2]);
    expect(kept[0]).toBe(rest[13]);
  });

  it("regression: returns an oversized tail that still exceeds the budget", () => {
    const huge = msg("user", "h".repeat(5000));
    const messages = [...manyMessages(3), huge, huge];

    const result = truncateMessages(messages, 1000);

    expect(result.some((m) => m.content === MARKER)).toBe(true);
    expect(result[result.length - 1]).toBe(huge);
    expect(estimateMessagesTokens(result)).toBeGreaterThan(1000);
  });

  it("keeps system messages even when they alone exceed the budget", () => {
    const system = msg("system", "s".repeat(5000));
    const messages = [system, ...manyMessages(5, 100)];

    const result = truncateMessages(messages, 1000);

    expect(result[0]).toBe(system);
    expect(result).toContainEqual(msg("user", MARKER));
  });
});
