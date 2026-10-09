import { Platform } from "react-native";

import {
  fetchModelsDevCatalogCached,
  getModelsDevDefinitionsForProvider,
} from "@/modules/config/models-dev-catalog";
import {
  fetchOnDeviceModelCatalogCached,
  getBundledOnDeviceModelCatalog,
  getOnDeviceModelDefinitions,
} from "@/modules/on-device/catalog";
import { fetchOllamaModels } from "@/modules/providers/ollama-models";
import {
  fetchCodexModelCatalogCached,
  getCodexBuiltInModels,
  isCodexOAuthModel,
} from "@/modules/providers/codex-models-catalog";
import {
  discoverChatGptModels,
  getFallbackChatGptModels,
} from "@/modules/providers/openai-chatgpt-models";
import {
  getValidOpenAiChatGptTokenInfo,
  getValidOpenAiChatGptTokenInfoForAccount,
} from "@/modules/providers/openai-chatgpt-oauth";
import { getOpenAiOAuthFlavor } from "@/modules/providers/openai";
import { resolveConfiguredModel } from "@/modules/config/registry";
import { secureSecretStore } from "@/core/services/secrets";
import {
  hasEnabledFolderTools,
  hasEnabledWorkspaceTools,
} from "./helpers";
import type {
  AppSettings,
  CuratedModelDefinition,
  ModelPreset,
  ProviderConfig,
  ResolvedConfig,
} from "@/core/types/app-state";
import { parseModelRef } from "@/core/types/app-state";

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

  for (const ns of ["ollama", "onDevice"] as const) {
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

export async function resolveConfig(
  input: {
    modelPresets: ModelPreset[];
    providers: ProviderConfig[];
    settings: AppSettings;
  },
  options: { discoverRemote?: boolean } = {},
) {
  const discoverRemote = options.discoverRemote ?? true;
  const providerCredentialMap = new Map<string, boolean>();
  let activeModelSelection: ReturnType<typeof parseModelRef> | null = null;

  if (input.settings.activeModelRef) {
    try {
      activeModelSelection = parseModelRef(input.settings.activeModelRef);
    } catch {
      activeModelSelection = null;
    }
  }

  for (const provider of input.providers) {
    providerCredentialMap.set(
      provider.id,
      await secureSecretStore.hasProviderCredential(provider),
    );
  }

  const activeProviderIds = input.providers
    .filter((provider) => providerCredentialMap.get(provider.id) === true)
    .map((provider) => provider.id);
  let modelsDevCatalog = {};
  let onDeviceModelDefinitions = getOnDeviceModelDefinitions(
    getBundledOnDeviceModelCatalog(),
  );
  const ollamaModelsByProvider: Record<string, CuratedModelDefinition[]> = {};
  const chatgptModelsByProvider: Record<string, CuratedModelDefinition[]> = {};
  const providerModelDiscovery: ResolvedConfig["providerModelDiscovery"] = {};
  const needsModelsDevCatalog = input.providers.some(
    (provider) =>
      provider.family !== "ollama" && provider.family !== "on-device",
  );

  await Promise.all([
    discoverRemote && needsModelsDevCatalog
      ? fetchModelsDevCatalogCached()
          .then((catalog) => {
            modelsDevCatalog = catalog;
          })
          .catch((error) => {
            console.warn("Failed to load the models.dev catalog.", error);
          })
      : Promise.resolve(),
    discoverRemote && activeProviderIds.includes("on-device")
      ? fetchOnDeviceModelCatalogCached()
          .then((models) => {
            onDeviceModelDefinitions = getOnDeviceModelDefinitions(models);
          })
          .catch((error) => {
            console.warn("Failed to load the on-device model catalog.", error);
          })
      : Promise.resolve(),
    ...(discoverRemote ? input.providers : [])
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
    ...(discoverRemote ? input.providers : [])
      .filter(
        (provider) =>
          provider.family === "openai" &&
          provider.authType === "oauth" &&
          getOpenAiOAuthFlavor(provider.id) === "chatgpt" &&
          activeProviderIds.includes(provider.id),
      )
      .map(async (provider) => {
        try {
          const accountId =
            await secureSecretStore.getActiveProviderAccountId(provider.id);
          const tokenInfo = accountId
            ? await getValidOpenAiChatGptTokenInfoForAccount(accountId)
            : await getValidOpenAiChatGptTokenInfo();

          if (!tokenInfo.accessToken) {
            throw new Error("ChatGPT plan is not connected.");
          }

          chatgptModelsByProvider[provider.id] = await discoverChatGptModels({
            baseURL: provider.baseUrl,
            clientId: tokenInfo.clientId,
            token: tokenInfo.accessToken,
          });
          providerModelDiscovery[provider.id] = {
            error: null,
            status: "connected",
          };
        } catch (error) {
          // Discovery is best-effort: the provider still falls back to the
          // bundled allowlist, so do not surface this as a connection failure.
          console.warn("Failed to discover ChatGPT plan models.", error);
          providerModelDiscovery[provider.id] = {
            error: null,
            status: "connected",
          };
        }
      }),
    discoverRemote &&
    input.providers.some(
      (provider) =>
        provider.family === "openai" &&
        provider.authType === "oauth" &&
        getOpenAiOAuthFlavor(provider.id) === "codex",
    )
      ? fetchCodexModelCatalogCached().catch((error) => {
          console.warn("Failed to load the Codex model catalog.", error);
        })
      : Promise.resolve(),
  ]);

  const suggestedModelsByProvider = Object.fromEntries(
    input.providers.map((provider) => {
      const oauthFlavor =
        provider.family === "openai" && provider.authType === "oauth"
          ? getOpenAiOAuthFlavor(provider.id)
          : null;
      const isChatGpt = oauthFlavor === "chatgpt";
      const builtInModels: CuratedModelDefinition[] =
        provider.family === "on-device"
          ? onDeviceModelDefinitions
          : isChatGpt
            ? (chatgptModelsByProvider[provider.id] ??
              getFallbackChatGptModels())
            : provider.family === "openai" && provider.authType === "oauth"
              ? getCodexBuiltInModels()
              : [];
      const discoveredModels = (
        isChatGpt
          ? []
          : [
              ...getModelsDevDefinitionsForProvider(modelsDevCatalog, provider),
              ...(ollamaModelsByProvider[provider.id] ?? []),
            ]
      )
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
                isChatGpt ||
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
        ...(activeModelSelection?.providerId === provider.id &&
        !discoveredModels.some(
          (model) => model.id === activeModelSelection.modelId,
        ) &&
        !builtInModels.some(
          (model) => model.id === activeModelSelection.modelId,
        ) &&
        !input.modelPresets.some(
          (preset) =>
            preset.providerId === provider.id &&
            preset.modelId === activeModelSelection.modelId,
        )
          ? [
              {
                id: activeModelSelection.modelId,
                kind: "chat" as const,
                label: activeModelSelection.modelId,
              },
            ]
          : []),
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

  const downloadedOnDeviceModelIds = new Set<string>();
  if (Platform.OS === "android" || Platform.OS === "ios") {
    try {
      const { getDownloadableModels } = await import("expo-ai-kit");
      const downloadableModels = await getDownloadableModels();

      for (const model of downloadableModels) {
        if (
          model.status === "downloaded" ||
          model.status === "loading" ||
          model.status === "ready"
        ) {
          downloadedOnDeviceModelIds.add(model.id);
        }
      }
    } catch (error) {
      console.warn("Failed to read downloaded on-device models.", error);
    }
  }

  const activeModels = availableModels.filter(
    (model) =>
      model.active &&
      (model.providerFamily !== "on-device" ||
        downloadedOnDeviceModelIds.has(model.modelId)),
  );
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
