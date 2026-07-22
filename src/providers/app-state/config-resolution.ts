import {
  fetchLiveModelCatalogCached,
  getCatalogModelDefinitionsForProvider,
  type LiveCatalogModel,
} from "@/lib/config/live-model-catalog";
import {
  fetchModelsDevCatalogCached,
  getModelsDevDefinitionsForProvider,
} from "@/lib/config/models-dev-catalog";
import {
  fetchOnDeviceModelCatalogCached,
  getBundledOnDeviceModelCatalog,
  getOnDeviceModelDefinitions,
} from "@/lib/on-device/catalog";
import { fetchOllamaModels } from "@/lib/providers/ollama-models";
import { resolveConfiguredModel } from "@/lib/config/registry";
import { secureSecretStore } from "@/lib/secrets";
import {
  hasEnabledFolderTools,
  hasEnabledWorkspaceTools,
  isCodexOAuthModel,
} from "./helpers";
import type {
  AppSettings,
  CuratedModelDefinition,
  ModelPreset,
  ProviderConfig,
  ResolvedConfig,
} from "@/types/app-state";

function mergeModelOptions(
  discoveryOptions: CuratedModelDefinition["options"],
  presetOptions: Record<string, unknown> | null | undefined,
): CuratedModelDefinition["options"] {
  if (!discoveryOptions && !presetOptions) return undefined;
  if (!discoveryOptions) return presetOptions ?? undefined;
  if (!presetOptions) return discoveryOptions ?? undefined;

  const merged: Record<string, unknown> = {
    ...discoveryOptions,
    ...presetOptions,
  };

  for (const ns of ["ollama"] as const) {
    const discNs =
      ns in discoveryOptions
        ? (discoveryOptions as Record<string, unknown>)[ns]
        : undefined;
    const presetNs =
      ns in presetOptions
        ? (presetOptions as Record<string, unknown>)[ns]
        : undefined;
    if (discNs || presetNs) {
      merged[ns] = {
        ...(typeof discNs === "object" && discNs !== null ? discNs : {}),
        ...(typeof presetNs === "object" && presetNs !== null ? presetNs : {}),
      };
    }
  }

  return merged;
}

export async function resolveConfig(input: {
  modelPresets: ModelPreset[];
  providers: ProviderConfig[];
  settings: AppSettings;
}) {
  const providerCredentialMap = new Map<string, boolean>();

  for (const provider of input.providers) {
    providerCredentialMap.set(
      provider.id,
      await secureSecretStore.hasProviderCredential(provider),
    );
  }

  const activeProviderIds = input.providers
    .filter((provider) => providerCredentialMap.get(provider.id) === true)
    .map((provider) => provider.id);
  let liveCatalog: LiveCatalogModel[] = [];
  let modelsDevCatalog = {};
  let onDeviceModelDefinitions = getOnDeviceModelDefinitions(
    getBundledOnDeviceModelCatalog(),
  );
  const ollamaModelsByProvider: Record<string, CuratedModelDefinition[]> = {};
  const providerModelDiscovery: ResolvedConfig["providerModelDiscovery"] = {};
  const needsModelsDevCatalog = input.providers.some(
    (provider) =>
      activeProviderIds.includes(provider.id) &&
      (provider.family === "openai-compatible" || provider.family === "xai") &&
      provider.id !== "openai-compatible",
  );

  await Promise.all([
    fetchLiveModelCatalogCached()
      .then((catalog) => {
        liveCatalog = catalog;
      })
      .catch((error) => {
        console.warn("Failed to load the AI Gateway model catalog.", error);
      }),
    needsModelsDevCatalog
      ? fetchModelsDevCatalogCached()
          .then((catalog) => {
            modelsDevCatalog = catalog;
          })
          .catch((error) => {
            console.warn("Failed to load the models.dev catalog.", error);
          })
      : Promise.resolve(),
    fetchOnDeviceModelCatalogCached()
      .then((models) => {
        onDeviceModelDefinitions = getOnDeviceModelDefinitions(models);
      })
      .catch((error) => {
        console.warn("Failed to load the on-device model catalog.", error);
      }),
    ...input.providers
      .filter(
        (provider) =>
          provider.family === "ollama" &&
          activeProviderIds.includes(provider.id),
      )
      .map(async (provider) => {
        try {
          ollamaModelsByProvider[provider.id] = await fetchOllamaModels(
            provider,
            await secureSecretStore.getProviderApiKey(provider.id),
          );
          providerModelDiscovery[provider.id] = {
            error: null,
            status: "connected",
          };
        } catch (error) {
          console.warn("Failed to discover Ollama models.", error);
          providerModelDiscovery[provider.id] = {
            error:
              error instanceof Error && error.name === "AbortError"
                ? "Connection timed out. Check the server address and network access."
                : error instanceof Error
                  ? error.message
                  : "Could not connect to Ollama.",
            status: "failed",
          };
        }
      }),
  ]);

  const suggestedModelsByProvider = Object.fromEntries(
    input.providers.map((provider) => {
      const builtInModels: CuratedModelDefinition[] =
        provider.family === "on-device"
          ? onDeviceModelDefinitions
          : provider.family === "openai" && provider.authType === "oauth"
            ? [
                {
                  id: "gpt-5.5",
                  kind: "chat",
                  label: "GPT-5.5",
                  capabilities: { tools: true },
                },
                {
                  id: "gpt-5.4",
                  kind: "chat",
                  label: "GPT-5.4",
                  capabilities: { tools: true },
                },
                {
                  id: "gpt-5.4-mini",
                  kind: "small",
                  label: "GPT-5.4 mini",
                  capabilities: { tools: true },
                },
              ]
            : [];
      const discoveredModels = [
        ...(ollamaModelsByProvider[provider.id] ?? []),
        ...getCatalogModelDefinitionsForProvider(liveCatalog, provider),
        ...getModelsDevDefinitionsForProvider(modelsDevCatalog, provider),
      ]
        .filter(
          (model) =>
            provider.family !== "openai" ||
            provider.authType !== "oauth" ||
            isCodexOAuthModel(model.id),
        )
        .filter(
          (model, index, models) =>
            models.findIndex((candidate) => candidate.id === model.id) ===
            index,
        );
      const models = [
        ...discoveredModels,
        ...builtInModels.filter(
          (model) =>
            !discoveredModels.some((discovered) => discovered.id === model.id),
        ),
        ...input.modelPresets
          .filter(
            (preset) =>
              preset.providerId === provider.id &&
              (provider.family !== "openai" ||
                provider.authType !== "oauth" ||
                isCodexOAuthModel(preset.modelId)) &&
              !discoveredModels.some((model) => model.id === preset.modelId) &&
              !builtInModels.some((model) => model.id === preset.modelId),
          )
          .map((preset) => ({
            id: preset.modelId,
            kind: "chat" as const,
            label: preset.label?.trim() || preset.modelId,
            options: preset.options ?? undefined,
          })),
      ];

      return [provider.id, models];
    }),
  );
  const availableModels = input.providers.flatMap((provider) => {
    const suggestions = suggestedModelsByProvider[provider.id] ?? [];

    return suggestions
      .map<ResolvedConfig["availableModels"][number] | null>((suggestion) => {
        const preset =
          input.modelPresets.find(
            (item) =>
              item.providerId === provider.id && item.modelId === suggestion.id,
          ) ?? null;

        return resolveConfiguredModel({
          active: activeProviderIds.includes(provider.id),
          definition: suggestion,
          isDefault: preset?.isDefault ?? false,
          modelId: suggestion.id,
          options: mergeModelOptions(suggestion.options, preset?.options),
          preset,
          provider,
        });
      })
      .filter((model): model is NonNullable<typeof model> => model !== null);
  });

  const activeModels = availableModels.filter((model) => model.active);
  const requestedModel =
    input.settings.activeModelRef === null
      ? null
      : (activeModels.find(
          (model) => model.ref === input.settings.activeModelRef,
        ) ?? null);
  const currentModel =
    requestedModel ??
    activeModels.find((model) => model.isDefault) ??
    activeModels[0] ??
    null;

  return {
    activeProviderIds,
    providers: input.providers,
    modelPresets: input.modelPresets,
    suggestedModelsByProvider,
    providerModelDiscovery,
    availableModels,
    activeModels,
    currentModel,
    currentModelSupportsImageGeneration:
      currentModel?.supportsImageGeneration ?? false,
    currentModelSupportsImageInput: currentModel?.supportsImageInput ?? false,
    currentModelSupportsTools:
      (currentModel?.supportsTools ?? false) &&
      (hasEnabledWorkspaceTools(input.settings.builtInToolSettings) ||
        hasEnabledFolderTools(input.settings.builtInToolSettings)),
    databaseMode: input.settings.databaseMode,
    databaseUrl: input.settings.databaseUrl,
  } satisfies ResolvedConfig;
}
