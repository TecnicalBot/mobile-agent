import { useMemo } from "react";

import { useChat } from "@/hooks/use-chat";
import { useConfig } from "@/hooks/use-config";
import { useModelsDevCatalog } from "@/hooks/use-models-dev-catalog";
import {
  findModelsDevModel,
  type ModelsDevModelInfo,
} from "@/modules/config/models-dev-catalog";
import type { ModelUsageSnapshot, ResolvedModel } from "@/core/types/app-state";

function getOllamaContextWindow(model: ResolvedModel): number | null {
  if (model.providerFamily !== "ollama") return null;
  const ollamaOpts = model.options?.ollama;
  if (ollamaOpts && typeof ollamaOpts === "object" && "contextWindow" in ollamaOpts) {
    const ctx = (ollamaOpts as { contextWindow?: unknown }).contextWindow;
    if (typeof ctx === "number" && ctx > 0) return ctx;
  }
  return null;
}

type DisplayUsage = {
  contextUsagePercent: number | null;
  contextWindow: number | null;
  costInput: number | null;
  costOutput: number | null;
  costTotal: number | null;
  inputTokens: number | null;
  isPartial: boolean;
  modelLabel: string;
  outputTokens: number | null;
  providerLabel: string;
  remainingContext: number | null;
  totalTokens: number | null;
};

function sumNullableNumbers(values: Array<number | null>) {
  let sawValue = false;
  let total = 0;

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      sawValue = true;
      total += value;
    }
  }

  return sawValue ? total : null;
}

function roundPercent(value: number | null) {
  if (value === null) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function enrichUsage(
  usage: ModelUsageSnapshot,
  catalogModel: ModelsDevModelInfo | null,
  fallbackContextWindow?: number | null,
) {
  const inputPricePerToken = catalogModel?.inputPricePerToken ?? null;
  const outputPricePerToken = catalogModel?.outputPricePerToken ?? null;
  const inputCost =
    usage.inputTokens !== null && inputPricePerToken !== null
      ? usage.inputTokens * inputPricePerToken
      : usage.costInput;
  const outputCost =
    usage.outputTokens !== null && outputPricePerToken !== null
      ? usage.outputTokens * outputPricePerToken
      : usage.costOutput;
  const totalCost =
    inputCost !== null || outputCost !== null
      ? (inputCost ?? 0) + (outputCost ?? 0)
      : usage.costTotal;
  const contextWindow =
    catalogModel?.contextWindow ??
    usage.contextWindow ??
    fallbackContextWindow ??
    null;
  const usedTokens =
    usage.totalTokens ??
    (usage.inputTokens !== null || usage.outputTokens !== null
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : null);
  const remainingContext =
    contextWindow !== null && usedTokens !== null
      ? Math.max(contextWindow - usedTokens, 0)
      : usage.remainingContext;
  const contextUsagePercent =
    contextWindow !== null && usedTokens !== null && contextWindow > 0
      ? roundPercent((usedTokens / contextWindow) * 100)
      : usage.contextUsagePercent;

  return {
    contextUsagePercent,
    contextWindow,
    costInput: inputCost,
    costOutput: outputCost,
    costTotal: totalCost,
    inputTokens: usage.inputTokens,
    isPartial: false,
    modelLabel: usage.modelLabel,
    outputTokens: usage.outputTokens,
    providerLabel: usage.providerLabel,
    remainingContext,
    totalTokens: usedTokens,
  } satisfies DisplayUsage;
}

export function useChatInfo() {
  const { currentModel } = useConfig();
  const { messages } = useChat();
  const { data: modelsDevCatalog } = useModelsDevCatalog();

  return useMemo(() => {
    const findCatalogModel = (
      usage: Pick<ModelUsageSnapshot, "modelId" | "providerId">,
    ) =>
      modelsDevCatalog
        ? findModelsDevModel(modelsDevCatalog, usage.providerId, usage.modelId)
        : null;
    const currentCatalogModel =
      currentModel !== null
        ? findCatalogModel({
            modelId: currentModel.modelId,
            providerId: currentModel.providerId,
          })
        : null;
    const assistantUsages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          message.status === "completed" &&
          message.metadata?.usage,
      )
      .map((message) => message.metadata?.usage)
      .filter((usage): usage is ModelUsageSnapshot => usage !== null && usage !== undefined);
    const latestUsage = assistantUsages.at(-1) ?? null;
    const latestCatalogModel = latestUsage !== null ? findCatalogModel(latestUsage) : null;
    const ollamaContextWindow =
      currentModel !== null ? getOllamaContextWindow(currentModel) : null;
    const fallbackContextWindow =
      ollamaContextWindow ?? currentModel?.contextWindow ?? null;

    const conversationTotals =
      assistantUsages.length > 0
        ? (() => {
            const enriched = assistantUsages.map((usage) =>
              enrichUsage(usage, findCatalogModel(usage), fallbackContextWindow),
            );
            const modelLabels = new Set(enriched.map((usage) => usage.modelLabel));
            const providerLabels = new Set(
              enriched.map((usage) => usage.providerLabel),
            );
            const partial =
              enriched.some(
                (usage) =>
                  usage.inputTokens === null ||
                  usage.outputTokens === null ||
                  usage.totalTokens === null ||
                  usage.costTotal === null,
              ) || modelLabels.size > 1;

            return {
              contextUsagePercent: null,
              contextWindow: null,
              costInput: sumNullableNumbers(enriched.map((usage) => usage.costInput)),
              costOutput: sumNullableNumbers(
                enriched.map((usage) => usage.costOutput),
              ),
              costTotal: sumNullableNumbers(enriched.map((usage) => usage.costTotal)),
              inputTokens: sumNullableNumbers(
                enriched.map((usage) => usage.inputTokens),
              ),
              isPartial: partial,
              modelLabel:
                modelLabels.size === 1
                  ? (enriched[0]?.modelLabel ?? "Unknown")
                  : "Multiple models",
              outputTokens: sumNullableNumbers(
                enriched.map((usage) => usage.outputTokens),
              ),
              providerLabel:
                providerLabels.size === 1
                  ? (enriched[0]?.providerLabel ?? "Unknown")
                  : "Multiple providers",
              remainingContext: null,
              totalTokens: sumNullableNumbers(
                enriched.map((usage) => usage.totalTokens),
              ),
            } satisfies DisplayUsage;
          })()
        : null;

    return {
      conversationTotals,
      currentModel: currentModel
        ? {
            contextWindow:
              currentCatalogModel?.contextWindow ??
              currentModel.contextWindow ??
              ollamaContextWindow ??
              null,
            modelId: currentModel.modelId,
            modelLabel: currentModel.label,
            providerId: currentModel.providerId,
            providerLabel: currentModel.providerLabel,
          }
        : null,
      latestTurn:
        latestUsage !== null
          ? enrichUsage(latestUsage, latestCatalogModel, fallbackContextWindow)
          : null,
    };
  }, [currentModel, modelsDevCatalog, messages]);
}
