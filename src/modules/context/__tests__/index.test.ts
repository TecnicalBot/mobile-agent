import { describe, expect, it } from "vitest";

import { prepareMessagesForLLM } from "../index";
import { estimateMessagesTokens } from "../token-estimator";
import {
  fakeModel,
  msg,
  windowForUsable,
} from "./test-fixtures";

describe("prepareMessagesForLLM", () => {
  it("returns messages unchanged when under the budget", () => {
    const messages = [
      msg("user", "hi"),
      msg("assistant", "hello there"),
      msg("user", "thanks"),
    ];
    const result = prepareMessagesForLLM({
      contextWindow: 1_000_000,
      messages,
      model: fakeModel(1_000_000),
    });

    expect(result.messages).toBe(messages);
    expect(result.didPrune).toBe(false);
    expect(result.didTruncate).toBe(false);
  });

  it("prunes tool outputs when that frees enough space", () => {
    const large = Array.from({ length: 9 }, () =>
      msg("user", "x".repeat(7_000)),
    );
    const tail = Array.from({ length: 4 }, () => msg("user", "small"));
    const messages = [...large, ...tail];

    const result = prepareMessagesForLLM({
      contextWindow: windowForUsable(5_000),
      messages,
      model: fakeModel(windowForUsable(5_000)),
    });

    expect(result.didPrune).toBe(true);
    expect(result.didTruncate).toBe(false);
    expect(result.messages[0]!.content).toMatch(/^\[Tool output pruned/);
    expect(estimateMessagesTokens(result.messages)).toBeLessThan(
      result.budget.usable,
    );
  });

  it("truncates old messages when pruning is not possible", () => {
    const messages = Array.from({ length: 50 }, () =>
      msg("user", "m".repeat(500)),
    );

    const result = prepareMessagesForLLM({
      contextWindow: windowForUsable(5_000),
      messages,
      model: fakeModel(windowForUsable(5_000)),
    });

    expect(result.didPrune).toBe(false);
    expect(result.didTruncate).toBe(true);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages[result.messages.length - 1]).toBe(
      messages[messages.length - 1],
    );
  });

  it("prunes then truncates when pruning alone is insufficient", () => {
    const large = Array.from({ length: 9 }, () =>
      msg("user", "x".repeat(7_000)),
    );
    const small = Array.from({ length: 50 }, () => msg("user", "m".repeat(500)));
    const messages = [...large, ...small];

    const result = prepareMessagesForLLM({
      contextWindow: windowForUsable(5_000),
      messages,
      model: fakeModel(windowForUsable(5_000)),
    });

    expect(result.didPrune).toBe(true);
    expect(result.didTruncate).toBe(true);
  });

  it("regression: can still overflow the budget after truncation", () => {
    const usable = 2_508;
    const contextWindow = windowForUsable(usable);
    const medium = Array.from({ length: 10 }, () =>
      msg("user", "m".repeat(100)),
    );
    const huge = msg("user", "h".repeat(usable * 4));
    const messages = [...medium, huge, huge];

    const result = prepareMessagesForLLM({
      contextWindow,
      messages,
      model: fakeModel(contextWindow),
    });

    expect(result.didTruncate).toBe(true);
    expect(estimateMessagesTokens(result.messages)).toBeGreaterThan(
      result.budget.usable,
    );
  });
});
