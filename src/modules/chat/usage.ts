import type { ModelUsageSnapshot } from "@/core/types/app-state";
import type { ModelsDevModelInfo } from "@/modules/config/models-dev-catalog";
import { isOpenAiSubscriptionProvider } from "@/modules/providers/openai";

export type DisplayUsage = {
  contextIsEstimated: boolean;
  contextTokens: number | null;
  contextUsagePercent: number | null;
  contextWindow: number | null;
  costInput: number | null;
  costOutput: number | null;
  costTotal: number | null;
  hasPaidUsage: boolean;
  inputTokens: number | null;
  isPartial: boolean;
  modelLabel: string;
  outputTokens: number | null;
  planCovered: boolean;
  providerLabel: string;
  remainingContext: number | null;
  totalTokens: number | null;
};

export function enrichUsage(
  usage: ModelUsageSnapshot,
  catalogModel: ModelsDevModelInfo | null,
  fallbackContextWindow?: number | null,
): DisplayUsage {
  const planCovered = isOpenAiSubscriptionProvider(usage.providerId);
  const inputPrice = catalogModel?.inputPricePerToken ?? null;
  const outputPrice = catalogModel?.outputPricePerToken ?? null;
  const cachedRead = Math.min(usage.cacheReadTokens ?? 0, usage.inputTokens ?? 0);
  const cachedWrite = Math.min(
    usage.cacheWriteTokens ?? 0,
    Math.max((usage.inputTokens ?? 0) - cachedRead, 0),
  );
  const inputCost = planCovered ? null
    : usage.inputTokens !== null && inputPrice !== null
      ? (usage.inputTokens - cachedRead - cachedWrite) * inputPrice +
        cachedRead * (catalogModel?.cacheReadPricePerToken ?? inputPrice) +
        cachedWrite * (catalogModel?.cacheWritePricePerToken ?? inputPrice)
      : usage.costInput;
  const outputCost = planCovered ? null
    : usage.outputTokens !== null && outputPrice !== null
      ? usage.outputTokens * outputPrice
      : usage.costOutput;
  const totalCost = planCovered ? null
    : inputCost !== null && outputCost !== null
      ? inputCost + outputCost
      : usage.costTotal;
  // The recorded limit reflects the actual runtime configuration (e.g. Ollama),
  // which can be smaller than the model's advertised catalog limit.
  const contextWindow = usage.contextWindow ?? catalogModel?.contextWindow ??
    fallbackContextWindow ?? null;
  // Old snapshots contain only multi-step totals. Do not present those as
  // context occupancy: even a healthy compacted run can bill >100% of a window.
  const contextTokens = usage.contextTokens ?? null;
  const totalTokens = usage.totalTokens ??
    (usage.inputTokens !== null || usage.outputTokens !== null
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : null);

  return {
    contextIsEstimated: usage.contextIsEstimated ?? false,
    contextTokens,
    contextUsagePercent: contextWindow !== null && contextWindow > 0 && contextTokens !== null
      ? Math.round((contextTokens / contextWindow) * 1000) / 10
      : null,
    contextWindow,
    costInput: inputCost,
    costOutput: outputCost,
    costTotal: totalCost,
    hasPaidUsage: !planCovered,
    inputTokens: usage.inputTokens,
    isPartial: usage.inputTokens === null || usage.outputTokens === null ||
      (!planCovered && totalCost === null),
    modelLabel: usage.modelLabel,
    outputTokens: usage.outputTokens,
    planCovered,
    providerLabel: usage.providerLabel,
    remainingContext: contextWindow !== null && contextTokens !== null
      ? Math.max(contextWindow - contextTokens, 0)
      : null,
    totalTokens,
  };
}
