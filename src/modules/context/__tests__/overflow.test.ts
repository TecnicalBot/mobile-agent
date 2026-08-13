import type { ModelMessage, ToolSet } from "ai";

import { describe, expect, it } from "vitest";

import {
  calculateContextBudget,
  getTokenUsage,
  isOverflow,
} from "../overflow";
import { estimateMessageTokens, estimateTokens } from "../token-estimator";
import { emptyTools, fakeModel, msg } from "./test-fixtures";

const LARGE = 1_000_000;

describe("calculateContextBudget", () => {
  it("computes the default 32K window with 4K output + 2K safety reserve", () => {
    const budget = calculateContextBudget({ model: fakeModel() });
    expect(budget.contextWindow).toBe(32_000);
    expect(budget.reserved).toBe(6_096);
    expect(budget.systemTokens).toBe(0);
    expect(budget.toolDefinitionTokens).toBe(0);
    expect(budget.usable).toBe(32_000 - 6_096);
  });

  it.each([
    [200_000, 193_904],
    [8_000, 5_200],
    [2_000, 1_300],
    [LARGE, LARGE - 6_096],
  ])("computes usable for a %i-token context window", (window, expected) => {
    const budget = calculateContextBudget({
      contextWindow: window,
      model: fakeModel(window),
    });
    expect(budget.usable).toBe(expected);
  });

  it("clamps the output reserve to the model default at large windows", () => {
    const budget = calculateContextBudget({
      contextWindow: LARGE,
      model: fakeModel(LARGE),
    });
    expect(budget.reserved).toBe(4_096 + 2_000);
  });

  it("clamps the output reserve to 25% of the window at small windows", () => {
    const budget = calculateContextBudget({
      contextWindow: 2_000,
      model: fakeModel(2_000),
    });
    expect(budget.reserved).toBe(500 + 200);
  });

  it("never drops below the 256/128 floors", () => {
    const budget = calculateContextBudget({
      contextWindow: 1_000,
      model: fakeModel(1_000),
    });
    expect(budget.reserved).toBe(256 + 128);
  });

  it("subtracts system prompt tokens", () => {
    const systemPrompt = "x".repeat(400);
    const budget = calculateContextBudget({
      model: fakeModel(),
      systemPrompt,
    });
    expect(budget.systemTokens).toBe(100);
    expect(budget.usable).toBe(32_000 - 6_096 - 100);
  });

  it("subtracts tool definition tokens", () => {
    const tools = { probe: { description: "xyz" } } as unknown as ToolSet;
    const budget = calculateContextBudget({ model: fakeModel(), tools });
    const expected = estimateTokens(JSON.stringify(tools));
    expect(budget.toolDefinitionTokens).toBe(expected);
    expect(budget.usable).toBe(32_000 - 6_096 - expected);
  });

  it("clamps usable to 0 when system + tools exceed the window", () => {
    const budget = calculateContextBudget({
      contextWindow: 1_000,
      model: fakeModel(1_000),
      systemPrompt: "x".repeat(10_000),
      tools: emptyTools(),
    });
    expect(budget.usable).toBe(0);
  });
});

describe("isOverflow", () => {
  it("returns true at the exact usable boundary (>=)", () => {
    const budget = calculateContextBudget({ model: fakeModel() });
    const atBoundary: ModelMessage[] = [
      msg("user", "x".repeat((budget.usable - 4) * 4)),
    ];
    expect(estimateMessageTokens(atBoundary[0]!)).toBe(budget.usable);
    expect(isOverflow(atBoundary, budget)).toBe(true);
  });

  it("returns false one token under the usable boundary", () => {
    const budget = calculateContextBudget({ model: fakeModel() });
    const underBoundary: ModelMessage[] = [
      msg("user", "x".repeat((budget.usable - 5) * 4)),
    ];
    expect(estimateMessageTokens(underBoundary[0]!)).toBe(budget.usable - 1);
    expect(isOverflow(underBoundary, budget)).toBe(false);
  });

  it("returns false for empty messages", () => {
    const budget = calculateContextBudget({ model: fakeModel() });
    expect(isOverflow([], budget)).toBe(false);
  });
});

describe("getTokenUsage", () => {
  it("reports totals, overshoot and percent", () => {
    const budget = calculateContextBudget({ model: fakeModel() });
    const messages = [msg("user", "x".repeat((budget.usable + 400) * 4))];
    const usage = getTokenUsage(messages, budget);
    expect(usage.total).toBe(budget.usable + 404);
    expect(usage.overBy).toBe(404);
    expect(usage.percent).toBeGreaterThan(100);
  });

  it("reports 100 percent when usable is 0", () => {
    const budget = calculateContextBudget({
      contextWindow: 1_000,
      model: fakeModel(1_000),
      systemPrompt: "x".repeat(10_000),
    });
    const usage = getTokenUsage([], budget);
    expect(usage.usable).toBe(0);
    expect(usage.percent).toBe(100);
  });
});
