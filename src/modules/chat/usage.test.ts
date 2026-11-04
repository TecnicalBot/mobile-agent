import { describe, expect, it } from "vitest";

import type { ModelUsageSnapshot } from "@/core/types/app-state";
import { enrichUsage } from "./usage";

const snapshot: ModelUsageSnapshot = {
  providerId: "openai-api", providerLabel: "OpenAI API", modelId: "gpt-5.4",
  modelLabel: "GPT", inputTokens: 340_000, outputTokens: 7_000,
  totalTokens: 347_000, contextTokens: 42_000, contextWindow: 100_000,
  costInput: null, costOutput: null, costTotal: null,
  contextUsagePercent: null, remainingContext: null,
};
const catalog = {
  contextWindow: 400_000, inputPricePerToken: 0.000002,
  outputPricePerToken: 0.00001, cacheReadPricePerToken: 0.0000002,
  cacheWritePricePerToken: 0.0000025,
};

describe("chat usage", () => {
  it("does not mistake 347% cumulative token usage for context occupancy", () => {
    expect(enrichUsage(snapshot, catalog)).toMatchObject({
      totalTokens: 347_000, contextTokens: 42_000, contextUsagePercent: 42,
      remainingContext: 58_000, contextWindow: 100_000,
    });
  });

  it("does not fabricate context occupancy for old multi-step snapshots", () => {
    expect(enrichUsage({ ...snapshot, contextTokens: undefined }, catalog)).toMatchObject({
      totalTokens: 347_000, contextTokens: null, contextUsagePercent: null,
      remainingContext: null,
    });
  });

  it("calculates billing over all steps, accounting for prompt caching", () => {
    const usage = enrichUsage({ ...snapshot, cacheReadTokens: 200_000, cacheWriteTokens: 20_000 }, catalog);
    expect(usage.costInput).toBeCloseTo(0.33);
    expect(usage.costOutput).toBeCloseTo(0.07);
    expect(usage.costTotal).toBeCloseTo(0.40);
  });

  it.each(["openai", "openai-chatgpt"])("does not assign API charges to %s plan usage", (providerId) => {
    expect(enrichUsage({ ...snapshot, providerId }, catalog)).toMatchObject({
      costInput: null, costOutput: null, costTotal: null, planCovered: true,
      hasPaidUsage: false, isPartial: false,
    });
  });

  it("does not present missing output pricing as a complete cost", () => {
    expect(enrichUsage(snapshot, { ...catalog, outputPricePerToken: null })).toMatchObject({
      costTotal: null, isPartial: true,
    });
  });

  it("preserves free model prices", () => {
    expect(enrichUsage(snapshot, { ...catalog, inputPricePerToken: 0, outputPricePerToken: 0 }).costTotal).toBe(0);
  });

  it("uses catalog context only when no runtime limit was recorded", () => {
    expect(enrichUsage({ ...snapshot, contextWindow: null }, catalog).contextWindow).toBe(400_000);
    expect(enrichUsage({ ...snapshot, contextWindow: null }, null, 8192).contextWindow).toBe(8192);
  });
});
