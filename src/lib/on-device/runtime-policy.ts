import type { DownloadableModel } from "expo-ai-kit";

import type { ResolvedModel } from "@/types/app-state";

export type OnDeviceToolsMode = "auto" | "on";

export type OnDeviceRuntimePolicy = {
  contextWindow: number | null;
  memoryConstrained: boolean;
  toolsEnabled: boolean;
  toolsMode: OnDeviceToolsMode;
};

function getOnDeviceOptions(model: ResolvedModel) {
  const value = model.options?.onDevice;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getOnDeviceToolsMode(model: ResolvedModel): OnDeviceToolsMode {
  return getOnDeviceOptions(model).toolsMode === "on" ? "on" : "auto";
}

export function getMemorySafeContextWindow(model: ResolvedModel) {
  const options = getOnDeviceOptions(model);
  const configured =
    typeof options.contextWindow === "number" && options.contextWindow > 0
      ? options.contextWindow
      : null;
  const safeLimit =
    typeof options.lowMemoryContextWindow === "number" &&
    options.lowMemoryContextWindow > 0
      ? options.lowMemoryContextWindow
      : Math.min(configured ?? 4_096, 4_096);

  return configured === null ? safeLimit : Math.min(configured, safeLimit);
}

export async function resolveOnDeviceRuntimePolicy(
  model: ResolvedModel,
): Promise<OnDeviceRuntimePolicy> {
  const options = getOnDeviceOptions(model);
  const configuredContext =
    typeof options.contextWindow === "number" && options.contextWindow > 0
      ? options.contextWindow
      : null;

  if (model.providerFamily !== "on-device") {
    return {
      contextWindow: configuredContext,
      memoryConstrained: false,
      toolsEnabled: model.supportsTools,
      toolsMode: "auto",
    };
  }

  let modelInfo: DownloadableModel | undefined;
  try {
    const { getDownloadableModels } = await import("expo-ai-kit");
    modelInfo = (await getDownloadableModels()).find(
      (candidate) => candidate.id === model.modelId,
    );
  } catch {}

  const memoryConstrained = modelInfo?.meetsRequirements === false;
  const toolsMode = getOnDeviceToolsMode(model);

  return {
    contextWindow: memoryConstrained
      ? getMemorySafeContextWindow(model)
      : configuredContext,
    memoryConstrained,
    toolsMode,
    toolsEnabled:
      model.supportsTools && (!memoryConstrained || toolsMode === "on"),
  };
}
