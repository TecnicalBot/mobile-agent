import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";
import type { DownloadableModel } from "expo-ai-kit";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { useAppState } from "@/hooks/use-app-state";
import { useTheme } from "@/hooks/use-theme";
import { invalidateModelsDevCatalog } from "@/modules/config/models-dev-catalog";
import { getSupportedProviderDefinition } from "@/modules/config/registry";
import { fetchOnDeviceModelCatalogCached } from "@/modules/on-device/catalog";
import { getOnDeviceToolsMode } from "@/modules/on-device/runtime-policy";
import {
  cancelPersistentModelDownload,
  getPersistentModelDownloadStatus,
  isPersistentModelDownloadActive,
  preparePersistentModelDownloadNotifications,
  startPersistentModelDownload,
  type PersistentModelDownloadState,
} from "@/modules/on-device/model-download";
import { cn } from "@/core/utils";
import {
  createModelRef,
  type CuratedModelDefinition,
  type ModelRef,
  type ProviderAccount,
  type ProviderConfig,
  type ResolvedModel,
} from "@/core/types/app-state";

type ProviderListItem = {
  key: string;
  label: string;
  models: CuratedModelDefinition[];
  provider: ProviderConfig;
  value: string;
};

export default function SettingsProvidersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { error: hydrationError, modelDiscoveryInProgress, ready } = useAppState();
  const {
    activeProviderIds,
    activeProviderAccountIds,
    availableModels,
    connectOpenAIOAuth,
    createModelPreset,
    createProvider,
    createProviderAccount,
    currentModel,
    deleteProvider,
    deleteProviderAccount,
    disconnectOpenAIOAuth,
    providers,
    providerAccounts,
    providerModelDiscovery,
    refresh,
    selectModel,
    suggestedModelsByProvider,
    switchProviderAccount,
    updateProvider,
  } = useConfig();
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [customProviderName, setCustomProviderName] = useState("");
  const [customProviderBaseUrl, setCustomProviderBaseUrl] = useState("");
  const [customProviderApiKey, setCustomProviderApiKey] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [customModelId, setCustomModelId] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountApiKey, setNewAccountApiKey] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [onDeviceModels, setOnDeviceModels] = useState<DownloadableModel[]>([]);
  const [onDeviceError, setOnDeviceError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, number>
  >({});
  const downloadStateRef = useRef<Record<string, PersistentModelDownloadState>>(
    {},
  );
  const onDeviceModelIdsRef = useRef<string[]>([]);

  const loadOnDeviceModels = useCallback(async () => {
    if (Platform.OS === "web") {
      setOnDeviceModels([]);
      setOnDeviceError("On-device models are available on Android and iOS.");
      return;
    }

    try {
      const catalogModels = await fetchOnDeviceModelCatalogCached();
      const catalogIds = new Set(catalogModels.map((model) => model.id));
      onDeviceModelIdsRef.current = [...catalogIds];
      const { getDownloadableModels } = await import("expo-ai-kit");
      const models = await getDownloadableModels();

      setOnDeviceModels(models.filter((model) => catalogIds.has(model.id)));
      setOnDeviceError(null);
    } catch (error) {
      setOnDeviceModels([]);
      setOnDeviceError(
        error instanceof Error
          ? error.message
          : "On-device AI is unavailable in this build.",
      );
    }
  }, []);

  const providerItems = useMemo<ProviderListItem[]>(() => {
    return [...providers]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((provider) => {
        const isCurrent = currentModel?.providerId === provider.id;
        const isActive = activeProviderIds.includes(provider.id);
        const models = suggestedModelsByProvider[provider.id] ?? [];
        const discovery = providerModelDiscovery[provider.id];
        const pulledModelCount = models.filter(
          (model) => model.options?.ollama,
        ).length;

        return {
          key: `provider:${provider.id}`,
          label: provider.label,
          models,
          provider,
          value: isCurrent
            ? "Current"
            : provider.family === "ollama" && discovery?.status === "failed"
              ? "Connection failed"
              : provider.family === "ollama" &&
                  discovery?.status === "connected"
                ? `${pulledModelCount} pulled`
                : isActive
                  ? `${models.length} available`
                  : provider.authType === "oauth"
                    ? "Connect"
                    : "Set up",
        } satisfies ProviderListItem;
      });
  }, [
    activeProviderIds,
    currentModel,
    providers,
    providerModelDiscovery,
    suggestedModelsByProvider,
  ]);

  const selectedItem =
    providerItems.find((item) => item.key === selectedItemKey) ?? null;
  const selectedProvider = selectedItem?.provider ?? null;
  const selectedProviderIsCustom = selectedProvider
    ? getSupportedProviderDefinition(selectedProvider.id) === null
    : false;
  const selectedProviderAccounts = useMemo(
    () =>
      selectedProvider
        ? providerAccounts.filter(
            (account) => account.providerId === selectedProvider.id,
          )
        : [],
    [providerAccounts, selectedProvider],
  );
  const selectedProviderActiveAccountId = selectedProvider
    ? (activeProviderAccountIds[selectedProvider.id] ?? null)
    : null;
  const selectedProviderActiveAccount =
    selectedProviderAccounts.find(
      (account) => account.id === selectedProviderActiveAccountId,
    ) ?? null;
  useEffect(() => {
    if (selectedProvider?.family !== "on-device") {
      return;
    }

    let disposed = false;
    void loadOnDeviceModels();

    if (Platform.OS !== "android") {
      return;
    }

    const syncDownloads = async () => {
      try {
        const modelIds = onDeviceModelIdsRef.current;
        if (modelIds.length === 0) return;

        const statuses = await Promise.all(
          modelIds.map(async (modelId) => ({
            modelId,
            status: await getPersistentModelDownloadStatus(modelId),
          })),
        );
        if (disposed) {
          return;
        }

        let completed = false;
        let failure: string | null = null;
        const activeProgress: Record<string, number> = {};

        for (const { modelId, status } of statuses) {
          const previous = downloadStateRef.current[modelId];
          if (isPersistentModelDownloadActive(status)) {
            activeProgress[modelId] = status.progress;
          } else if (
            status.state === "succeeded" &&
            (previous === "queued" || previous === "downloading")
          ) {
            completed = true;
          } else if (
            status.state === "failed" &&
            (previous === "queued" || previous === "downloading")
          ) {
            failure = status.error ?? "The model download failed.";
          }
          downloadStateRef.current[modelId] = status.state;
        }

        setDownloadProgress((current) => {
          const next = { ...current };
          for (const modelId of modelIds) {
            delete next[modelId];
          }
          return { ...next, ...activeProgress };
        });

        if (failure) {
          setOnDeviceError(failure);
        }
        if (completed) {
          await loadOnDeviceModels();
          await refresh();
        }
      } catch (error) {
        if (!disposed) {
          setOnDeviceError(
            error instanceof Error
              ? error.message
              : "Persistent downloads are unavailable.",
          );
        }
      }
    };

    void syncDownloads();
    const interval = setInterval(() => void syncDownloads(), 750);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [loadOnDeviceModels, refresh, selectedProvider?.family]);
  const selectedProviderId = selectedProvider?.id ?? null;
  const selectedProviderActive = selectedProviderId
    ? activeProviderIds.includes(selectedProviderId)
    : false;
  const selectedProviderDiscovery = selectedProviderId
    ? providerModelDiscovery[selectedProviderId]
    : undefined;
  const selectedProviderModels = useMemo(() => {
    if (!selectedProviderId) {
      return [];
    }

    return availableModels.filter(
      (model) => model.providerId === selectedProviderId,
    );
  }, [availableModels, selectedProviderId]);
  const displayModels = useMemo(() => {
    if (!selectedItem || !selectedProviderId) {
      return [];
    }

    const query = modelQuery.trim().toLowerCase();
    return selectedItem.models
      .filter((model) => {
        if (!query) {
          return true;
        }

        const haystack = `${model.label} ${model.id}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => {
        const leftRef = createModelRef(selectedProviderId, left.id);
        const rightRef = createModelRef(selectedProviderId, right.id);
        const leftCurrent = currentModel?.ref === leftRef;
        const rightCurrent = currentModel?.ref === rightRef;
        if (leftCurrent !== rightCurrent) {
          return leftCurrent ? -1 : 1;
        }

        return left.label.localeCompare(right.label);
      });
  }, [currentModel?.ref, modelQuery, selectedItem, selectedProviderId]);
  const modelSections = useMemo(
    () => [
      {
        label: "Text models",
        models: displayModels.filter((model) => model.outputType !== "image"),
      },
      {
        label: "Image models",
        models: displayModels.filter((model) => model.outputType === "image"),
      },
    ],
    [displayModels],
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);

    try {
      await action();
    } finally {
      setBusyKey(null);
    }
  };

  const resetCustomProviderForm = () => {
    setCustomProviderName("");
    setCustomProviderBaseUrl("");
    setCustomProviderApiKey("");
  };

  const addCustomProvider = async () => {
    const apiKey = customProviderApiKey.trim();

    await createProvider({
      apiKey: apiKey || undefined,
      authType: apiKey ? "apiKey" : "none",
      baseUrl: customProviderBaseUrl.trim(),
      enabled: true,
      family: "openai-compatible",
      id: `custom-${Crypto.randomUUID()}`,
      label: customProviderName.trim(),
    });
    setAddProviderOpen(false);
    resetCustomProviderForm();
  };

  const confirmDeleteProvider = () => {
    if (!selectedProvider || !selectedProviderIsCustom) return;

    Alert.alert(
      `Delete ${selectedProvider.label}?`,
      "Its model presets and saved API key will also be deleted. Conversations will remain.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => {
            void runAction(`delete-provider:${selectedProvider.id}`, async () => {
              await deleteProvider(selectedProvider.id);
              setSelectedItemKey(null);
            }).catch((error) => {
              Alert.alert(
                "Provider could not be deleted",
                error instanceof Error ? error.message : "Please try again.",
              );
            });
          },
        },
      ],
    );
  };

  const downloadOnDeviceModel = async (modelId: string, label: string) => {
    setOnDeviceError(null);
    setDownloadProgress((current) => ({ ...current, [modelId]: 0 }));

    try {
      if (Platform.OS === "android") {
        const notificationsGranted =
          await preparePersistentModelDownloadNotifications();
        const status = await startPersistentModelDownload(modelId, label);
        downloadStateRef.current[modelId] = status.state;
        setDownloadProgress((current) => ({
          ...current,
          [modelId]: status.progress,
        }));
        if (!notificationsGranted) {
          setOnDeviceError(
            "Download started, but notification permission is disabled.",
          );
        }
      } else {
        const { downloadModel } = await import("expo-ai-kit");

        await downloadModel(modelId, {
          onProgress: (progress) => {
            setDownloadProgress((current) => ({
              ...current,
              [modelId]: progress,
            }));
          },
        });
        await loadOnDeviceModels();
      }
      await updateProvider("on-device", { enabled: true });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : null;

      if (code !== "DOWNLOAD_CANCELLED") {
        setOnDeviceError(
          error instanceof Error ? error.message : "The model download failed.",
        );
      }
      setDownloadProgress((current) => {
        const next = { ...current };
        delete next[modelId];
        return next;
      });
    }
  };

  const cancelOnDeviceDownload = async (modelId: string) => {
    if (Platform.OS === "android") {
      await cancelPersistentModelDownload(modelId);
      downloadStateRef.current[modelId] = "cancelled";
    } else {
      const { cancelDownload } = await import("expo-ai-kit");
      await cancelDownload(modelId);
    }
    setDownloadProgress((current) => {
      const next = { ...current };
      delete next[modelId];
      return next;
    });
  };

  const getOnDeviceBackend = (modelId: string) => {
    const model = selectedProviderModels.find(
      (candidate) => candidate.modelId === modelId,
    );
    const onDevice = model?.options?.onDevice;
    if (onDevice && typeof onDevice === "object") {
      const backend = (onDevice as { backend?: unknown }).backend;
      if (backend === "cpu" || backend === "gpu") return backend;
    }
    return "auto" as const;
  };

  const activateOnDeviceModel = async (modelId: string) => {
    setOnDeviceError(null);

    try {
      const { setModel } = await import("expo-ai-kit");
      await setModel(modelId, {
        backend: getOnDeviceBackend(modelId),
      });
      await updateProvider("on-device", { enabled: true });
      await selectModel(createModelRef("on-device", modelId));
      await loadOnDeviceModels();
    } catch (error) {
      setOnDeviceError(
        error instanceof Error
          ? error.message
          : "The model could not be loaded.",
      );
    }
  };

  const saveOnDeviceToolsMode = async (
    modelId: string,
    label: string,
    enabled: boolean,
  ) => {
    const model = selectedProviderModels.find(
      (candidate) => candidate.modelId === modelId,
    );
    const existingOptions = model?.options ?? {};
    const existingOnDevice =
      existingOptions.onDevice &&
      typeof existingOptions.onDevice === "object" &&
      !Array.isArray(existingOptions.onDevice)
        ? existingOptions.onDevice
        : {};

    await createModelPreset({
      label,
      modelId,
      options: {
        ...existingOptions,
        onDevice: {
          ...existingOnDevice,
          toolsMode: enabled ? "on" : "auto",
        },
      },
      providerId: "on-device",
    });
  };

  const changeOnDeviceToolsMode = (
    modelId: string,
    label: string,
    enabled: boolean,
  ) => {
    const save = () =>
      runAction("tools-mode:" + modelId, () =>
        saveOnDeviceToolsMode(modelId, label, enabled),
      ).catch((error) => {
        setOnDeviceError(
          error instanceof Error
            ? error.message
            : "The tools preference could not be saved.",
        );
      });

    if (!enabled) {
      void save();
      return;
    }

    Alert.alert(
      "Enable tools anyway?",
      "This device has less than the model recommended memory. Tools may exceed the safe context limit. You can switch back to memory-safe mode here.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => void save(), text: "Enable tools" },
      ],
    );
  };

  const confirmDeleteOnDeviceModel = (modelId: string, label: string) => {
    Alert.alert(
      `Delete ${label}?`,
      "The downloaded model will be removed from this device. Your conversations will remain.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => {
            void runAction(`delete-model:${modelId}`, async () => {
              const { deleteModel, getDownloadableModels, setModel } =
                await import("expo-ai-kit");
              if (Platform.OS === "android") {
                await cancelPersistentModelDownload(modelId);
              }
              await deleteModel(modelId);
              const catalogIds = new Set(onDeviceModelIdsRef.current);
              const remaining = (await getDownloadableModels()).filter(
                (model) =>
                  catalogIds.has(model.id) &&
                  (model.status === "downloaded" ||
                    model.status === "ready" ||
                    model.status === "loading"),
              );

              if (remaining.length === 0) {
                await updateProvider("on-device", {
                  enabled: false,
                });
              } else if (
                currentModel?.ref === createModelRef("on-device", modelId)
              ) {
                await setModel(remaining[0].id, {
                  backend: getOnDeviceBackend(remaining[0].id),
                });
                await selectModel(createModelRef("on-device", remaining[0].id));
              } else {
                await refresh();
              }

              await loadOnDeviceModels();
            }).catch((error) => {
              setOnDeviceError(
                error instanceof Error
                  ? error.message
                  : "The model could not be deleted.",
              );
            });
          },
        },
      ],
    );
  };
  const selectedProviderNeedsBaseUrl =
    selectedProvider?.family === "openai-compatible" ||
    selectedProvider?.family === "xai" ||
    selectedProvider?.family === "ollama";

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => {
            router.back();
          }}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Providers
        </Text>
        <Button
          className="ml-auto"
          leftIcon={<Plus color={theme.text} size={16} />}
          onPress={() => setAddProviderOpen(true)}
          size="sm"
          variant="outline"
        >
          Add custom
        </Button>
      </View>

      {hydrationError && !ready ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {hydrationError}
          </Text>
        </Card>
      ) : !ready ? (
        <Card
          accessibilityLabel="Loading providers"
          className="gap-sp-3 px-sp-4 py-sp-4"
        >
          {[0, 1, 2, 3].map((item) => (
            <View key={item} className="flex-row items-center justify-between gap-sp-3">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-1/4" />
            </View>
          ))}
        </Card>
      ) : providerItems.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No providers configured. Use Add custom above to add one.
          </Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {providerItems.map((provider, index) => (
            <View key={provider.key}>
              {index > 0 ? <Separator /> : null}
              <SettingsLinkRow
                chevronColor={theme.textSecondary}
                label={provider.label}
                onPress={() => {
                  setBaseUrlInput(provider.provider.baseUrl ?? "");
                  setCustomModelId("");
                  setModelQuery("");
                  setSelectedItemKey(provider.key);
                }}
                value={provider.value}
              />
            </View>
          ))}
        </Card>
      )}

      <Drawer
        onOpenChange={(open) => {
          setAddProviderOpen(open);
          if (!open) resetCustomProviderForm();
        }}
        open={addProviderOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Add custom provider</DrawerTitle>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Connect an OpenAI-compatible endpoint. You can add multiple model
              IDs after creating it.
            </Text>
            <Input
              autoCapitalize="words"
              onChangeText={setCustomProviderName}
              placeholder="Provider name"
              value={customProviderName}
            />
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setCustomProviderBaseUrl}
              placeholder="Base URL"
              value={customProviderBaseUrl}
            />
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setCustomProviderApiKey}
              placeholder="API key (optional)"
              secureTextEntry
              value={customProviderApiKey}
            />
          </DrawerBody>
          <DrawerFooter>
            <View className="flex-row gap-sp-2">
              <Button
                className="flex-1"
                disabled={busyKey !== null}
                onPress={() => setAddProviderOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={
                  !customProviderName.trim() || !customProviderBaseUrl.trim()
                }
                loading={busyKey === "add-provider"}
                onPress={() => {
                  void runAction("add-provider", addCustomProvider).catch(
                    (error) => {
                      Alert.alert(
                        "Provider could not be added",
                        error instanceof Error
                          ? error.message
                          : "Please try again.",
                      );
                    },
                  );
                }}
              >
                Add provider
              </Button>
            </View>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItemKey(null);
            setBaseUrlInput("");
            setCustomModelId("");
            setModelQuery("");
            setAddingAccount(false);
            setNewAccountLabel("");
            setNewAccountApiKey("");
          }
        }}
        open={selectedItemKey !== null}
      >
        <DrawerContent showCloseButton showHandle size={720}>
          {selectedItem && selectedProvider ? (
            <>
              <DrawerHeader>
                <DrawerTitle>{selectedItem.label}</DrawerTitle>
              </DrawerHeader>

              <DrawerBody contentContainerClassName="pb-sp-4">
                <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                  <StatusRow
                    label="Status"
                    value={
                      selectedProvider?.family === "ollama"
                        ? selectedProviderDiscovery?.status === "connected"
                          ? "Connected"
                          : selectedProviderDiscovery?.status === "failed"
                            ? "Connection failed"
                            : selectedProviderActive
                              ? "Checking"
                              : "Not set up"
                        : selectedProviderActive
                          ? "Ready"
                          : "Not set up"
                    }
                  />
                  <Separator />
                  <StatusRow label="Family" value={selectedProvider.family} />
                  {currentModel?.providerId === selectedProvider.id ? (
                    <>
                      <Separator />
                      <StatusRow
                        label="Current model"
                        value={currentModel.label}
                      />
                    </>
                  ) : null}
                </View>

                {selectedProvider.authType === "apiKey" ? (
                  <View className="gap-sp-2">
                    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {selectedProviderActive
                        ? "Active account"
                        : "Account"}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setNewAccountLabel("");
                        setNewAccountApiKey("");
                        setAddingAccount(false);
                        setSelectedAccountIds([]);
                        setAccountManagerOpen(true);
                      }}
                      style={({ pressed }) =>
                        pressed ? { opacity: 0.82 } : null
                      }
                      className="flex-row items-center justify-between overflow-hidden rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark"
                    >
                      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                        {selectedProviderActive
                          ? (selectedProviderActiveAccount?.label ?? "None")
                          : "Add account"}
                      </Text>
                      {selectedProviderActive ? (
                        <View className="flex-row items-center gap-sp-1">
                          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                            Switch
                          </Text>
                          <ChevronRight
                            color={theme.textSecondary}
                            size={18}
                          />
                        </View>
                      ) : (
                        <ChevronRight
                          color={theme.textSecondary}
                          size={18}
                        />
                      )}
                    </Pressable>
                  </View>
                ) : null}

                {selectedProvider.family === "ollama" &&
                selectedProviderDiscovery?.error ? (
                  <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                    {selectedProviderDiscovery.error}
                  </Text>
                ) : null}

                {selectedProvider.family === "on-device" ? (
                  <View className="gap-sp-3">
                    {onDeviceError ? (
                      <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                        {onDeviceError}
                      </Text>
                    ) : null}
                    <View className="flex-row gap-sp-2">
                      <Button
                        className="flex-1"
                        onPress={() => {
                          void loadOnDeviceModels();
                        }}
                        variant="secondary"
                      >
                        Refresh
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={!selectedProviderActive}
                        onPress={() => {
                          void updateProvider("on-device", { enabled: false });
                        }}
                        variant="outline"
                      >
                        Disable
                      </Button>
                    </View>
                  </View>
                ) : selectedProvider.authType === "oauth" ? (
                  <View className="gap-sp-3">
                    {selectedProvider.oauthAccountEmail ? (
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        {selectedProvider.oauthAccountEmail}
                      </Text>
                    ) : null}
                    <View className="flex-row gap-sp-2">
                      <Button
                        className="flex-1"
                        loading={busyKey === `connect:${selectedProvider.id}`}
                        onPress={() => {
                          runAction(
                            `connect:${selectedProvider.id}`,
                            connectOpenAIOAuth,
                          ).catch(console.error);
                        }}
                        variant="secondary"
                      >
                        Connect
                      </Button>
                      <Button
                        className="flex-1"
                        loading={
                          busyKey === `disconnect:${selectedProvider.id}`
                        }
                        onPress={() => {
                          runAction(
                            `disconnect:${selectedProvider.id}`,
                            disconnectOpenAIOAuth,
                          ).catch(console.error);
                        }}
                        variant="outline"
                      >
                        Disconnect
                      </Button>
                    </View>
                  </View>
                ) : selectedProvider.family === "ollama" ? (
                  <View className="gap-sp-3">
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      onChangeText={setBaseUrlInput}
                      placeholder="Ollama server URL"
                      value={baseUrlInput}
                    />
                    <View className="flex-row gap-sp-2">
                      <Button
                        className="flex-1"
                        disabled={!baseUrlInput.trim()}
                        loading={busyKey === `connect:${selectedProvider.id}`}
                        onPress={() => {
                          runAction(
                            `connect:${selectedProvider.id}`,
                            async () => {
                              await updateProvider(selectedProvider.id, {
                                baseUrl: baseUrlInput.trim(),
                                enabled: true,
                              });
                            },
                          ).catch(console.error);
                        }}
                        variant="secondary"
                      >
                        Connect
                      </Button>
                      <Button
                        className="flex-1"
                        onPress={() => {
                          runAction(
                            `disconnect:${selectedProvider.id}`,
                            async () => {
                              await updateProvider(selectedProvider.id, {
                                enabled: false,
                              });
                            },
                          ).catch(console.error);
                        }}
                        variant="outline"
                      >
                        Disconnect
                      </Button>
                    </View>
                  </View>
                ) : (
                  <View className="gap-sp-3">
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      onChangeText={setBaseUrlInput}
                      placeholder={
                        selectedProviderNeedsBaseUrl
                          ? "Base URL"
                          : "Endpoint override (optional)"
                      }
                      value={baseUrlInput}
                    />
                    <View className="flex-row gap-sp-2">
                      <Button
                        className="flex-1"
                        disabled={
                          selectedProviderNeedsBaseUrl && !baseUrlInput.trim()
                        }
                        loading={busyKey === `save:${selectedProvider.id}`}
                        onPress={() => {
                          runAction(`save:${selectedProvider.id}`, async () => {
                            const normalizedBaseUrl = baseUrlInput.trim();
                            await updateProvider(selectedProvider.id, {
                              baseUrl:
                                normalizedBaseUrl ||
                                (selectedProviderNeedsBaseUrl
                                  ? null
                                  : selectedProvider.baseUrl),
                              enabled: true,
                              label: selectedItem.label,
                            });
                          }).catch(console.error);
                        }}
                        variant="secondary"
                      >
                        Save
                      </Button>
                      <Button
                        className="flex-1"
                        onPress={() => {
                          runAction(
                            `disable:${selectedProvider.id}`,
                            async () => {
                              await updateProvider(selectedProvider.id, {
                                enabled: false,
                              });
                            },
                          ).catch(console.error);
                        }}
                        variant="outline"
                      >
                        Disable
                      </Button>
                    </View>
                  </View>
                )}

                <View className="gap-sp-3">
                  <View className="flex-row items-center justify-between gap-sp-3">
                    <Text className="flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {selectedProvider.family === "on-device"
                        ? "Downloaded models stay on this device"
                        : selectedProvider.authType === "oauth"
                          ? "Models supported by ChatGPT OAuth"
                          : "Models from live provider catalogs"}
                    </Text>
                    {selectedProvider.authType === "apiKey" ||
                    selectedProvider.family === "ollama" ? (
                      <Button
                        loading={
                          busyKey === `refresh-models:${selectedProvider.id}`
                        }
                        onPress={() => {
                          runAction(
                            `refresh-models:${selectedProvider.id}`,
                            async () => {
                              invalidateModelsDevCatalog();
                              await refresh();
                            },
                          ).catch(console.error);
                        }}
                        size="xs"
                        variant="outline"
                      >
                        Refresh
                      </Button>
                    ) : null}
                  </View>
                  {!selectedProviderIsCustom ||
                  selectedItem.models.length > 0 ? (
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={setModelQuery}
                      placeholder="Search models"
                      value={modelQuery}
                    />
                  ) : null}

                  {selectedProviderIsCustom ? (
                    <View className="flex-row gap-sp-2">
                      <Input
                        autoCapitalize="none"
                        autoCorrect={false}
                        className="flex-1"
                        onChangeText={setCustomModelId}
                        placeholder="Model ID"
                        value={customModelId}
                      />
                      <Button
                        disabled={
                          !customModelId.trim() || !selectedProviderActive
                        }
                        loading={
                          busyKey ===
                          `custom-model:${selectedProvider.id}:${customModelId.trim()}`
                        }
                        onPress={() => {
                          const modelId = customModelId.trim();
                          runAction(
                            `custom-model:${selectedProvider.id}:${modelId}`,
                            async () => {
                              await createModelPreset({
                                label: modelId,
                                makeDefault:
                                  selectedProviderModels.length === 0,
                                modelId,
                                providerId: selectedProvider.id,
                                select: true,
                              });
                              setCustomModelId("");
                            },
                          ).catch(console.error);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Use
                      </Button>
                    </View>
                  ) : null}

                  {selectedProvider.family === "on-device" ? (
                    <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                      {displayModels.map((model, index) => {
                        const info =
                          onDeviceModels.find((item) => item.id === model.id) ??
                          null;
                        const modelRef = createModelRef(
                          selectedProvider.id,
                          model.id,
                        ) as ModelRef;
                        const resolvedModel =
                          selectedProviderModels.find(
                            (candidate) => candidate.ref === modelRef,
                          ) ?? null;
                        const toolsForcedOn =
                          resolvedModel !== null &&
                          getOnDeviceToolsMode(resolvedModel) === "on";

                        return (
                          <View key={model.id}>
                            {index > 0 ? <Separator /> : null}
                            <OnDeviceModelRow
                              checkColor={theme.text}
                              current={currentModel?.ref === modelRef}
                              downloadProgress={downloadProgress[model.id]}
                              info={info}
                              label={model.label}
                              loading={
                                busyKey === `model:${model.id}` ||
                                busyKey === `delete-model:${model.id}` ||
                                busyKey === "download-model:" + model.id ||
                                busyKey === "tools-mode:" + model.id
                              }
                              memoryConstrained={
                                info?.meetsRequirements === false
                              }
                              onToolsModeChange={() => {
                                changeOnDeviceToolsMode(
                                  model.id,
                                  model.label,
                                  !toolsForcedOn,
                                );
                              }}
                              toolsForcedOn={toolsForcedOn}
                              toolsSupported={
                                resolvedModel?.supportsTools ??
                                model.capabilities?.tools ??
                                false
                              }
                              onActivate={() => {
                                void runAction(`model:${model.id}`, () =>
                                  activateOnDeviceModel(model.id),
                                );
                              }}
                              onCancel={() => {
                                void cancelOnDeviceDownload(model.id).catch(
                                  (error) => {
                                    setOnDeviceError(
                                      error instanceof Error
                                        ? error.message
                                        : "The download could not be cancelled.",
                                    );
                                  },
                                );
                              }}
                              onDelete={() => {
                                confirmDeleteOnDeviceModel(
                                  model.id,
                                  model.label,
                                );
                              }}
                              onDownload={() => {
                                const download = () => {
                                  void runAction(
                                    `download-model:${model.id}`,
                                    () =>
                                      downloadOnDeviceModel(
                                        model.id,
                                        model.label,
                                      ),
                                  );
                                };

                                if (info?.meetsRequirements === false) {
                                  Alert.alert(
                                    "Download anyway?",
                                    `${model.label} recommends at least ${formatBytes(info.minRamBytes)} of RAM. On this device it may run slowly, fail to load, or cause the app to close.`,
                                    [
                                      { style: "cancel", text: "Cancel" },
                                      {
                                        onPress: download,
                                        text: "Download anyway",
                                      },
                                    ],
                                  );
                                  return;
                                }

                                download();
                              }}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ) : displayModels.length > 0 ? (
                    modelSections.map((section) =>
                      section.models.length > 0 ? (
                        <View className="gap-sp-2" key={section.label}>
                          <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                            {section.label}
                          </Text>
                          <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                            {section.models.map((model, index) => {
                              const modelRef = createModelRef(
                                selectedProvider.id,
                                model.id,
                              ) as ModelRef;
                              const resolvedModel =
                                selectedProviderModels.find(
                                  (item) => item.ref === modelRef,
                                ) ?? null;
                              const current = currentModel?.ref === modelRef;

                              return (
                                <View key={model.id}>
                                  {index > 0 ? <Separator /> : null}
                                  <ProviderModelRow
                                    capabilityBadges={buildCapabilityBadges(
                                      resolvedModel ?? model,
                                    ).concat(
                                      selectedProvider.family === "ollama" &&
                                        model.options?.ollama
                                        ? ["Pulled"]
                                        : [],
                                    )}
                                    checkColor={theme.text}
                                    current={current}
                                    label={model.label}
                                    modelId={model.id}
                                    onPress={() => {
                                      runAction(
                                        `model:${selectedProvider.id}:${model.id}`,
                                        async () => {
                                          if (
                                            !current &&
                                            selectedProviderActive
                                          ) {
                                            await selectModel(modelRef);
                                          }
                                        },
                                      ).catch(console.error);
                                    }}
                                    stateLabel={
                                      current
                                        ? "Current"
                                        : selectedProviderActive
                                          ? "Use"
                                          : "Available"
                                    }
                                  />
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      ) : null,
                    )
                  ) : !selectedProviderIsCustom && modelDiscoveryInProgress ? (
                    <View className="flex-row items-center gap-sp-2 py-sp-1">
                      <ActivityIndicator color={theme.text} size="small" />
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        Loading models…
                      </Text>
                    </View>
                  ) : (
                    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {selectedProvider.family === "ollama" &&
                      selectedProviderDiscovery?.status === "connected"
                        ? "Connected, but no pulled models were found. Pull a model in Ollama, then tap Refresh."
                        : selectedProvider.family === "ollama"
                          ? "Connect to Ollama to load pulled models."
                          : "No models found"}
                    </Text>
                  )}
                </View>
              </DrawerBody>
              <DrawerFooter>
                {selectedProviderIsCustom ? (
                  <Button
                    loading={
                      busyKey === `delete-provider:${selectedProvider.id}`
                    }
                    onPress={confirmDeleteProvider}
                    variant="destructive"
                  >
                    Delete provider
                  </Button>
                ) : (
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {selectedProvider.family === "on-device"
                      ? "Downloads are verified and stored only on this device."
                      : "Models from configured providers are available automatically."}
                  </Text>
                )}
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          setAccountManagerOpen(open);
          if (!open) {
            setNewAccountLabel("");
            setNewAccountApiKey("");
            setSelectedAccountIds([]);
          }
        }}
        open={accountManagerOpen}
      >
        {selectedProvider ? (
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>Accounts</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
              <AccountManager
                accounts={
                  selectedProviderActive ? selectedProviderAccounts : []
                }
                activeAccountId={
                  selectedProviderActive ? selectedProviderActiveAccountId : null
                }
                busy={busyKey !== null}
                onEnterSelectionMode={(accountId) => {
                  setSelectedAccountIds([accountId]);
                }}
                onPress={(accountId) => {
                  if (busyKey !== null) return;
                  if (selectedAccountIds.length > 0) {
                    setSelectedAccountIds((prev) =>
                      prev.includes(accountId)
                        ? prev.filter((id) => id !== accountId)
                        : [...prev, accountId],
                    );
                  } else {
                    const account = selectedProviderAccounts.find(
                      (item) => item.id === accountId,
                    );
                    if (account) {
                      void runAction(
                        `switch:${account.id}`,
                        async () => {
                          await switchProviderAccount({
                            accountId: account.id,
                            providerId: selectedProvider.id,
                          });
                        },
                      ).catch(console.error);
                    }
                  }
                }}
                selectedAccountIds={selectedAccountIds}
              />
            </DrawerBody>
            {selectedAccountIds.length > 0 ? (
              <DrawerFooter>
                <Button
                  disabled={busyKey !== null}
                  onPress={() => {
                    Alert.alert(
                      `Delete ${selectedAccountIds.length} account${
                        selectedAccountIds.length === 1 ? "" : "s"
                      }?`,
                      "This will remove the saved credentials for the selected accounts.",
                      [
                        { style: "cancel", text: "Cancel" },
                        {
                          style: "destructive",
                          text: "Delete",
                          onPress: () => {
                            void runAction("delete-accounts", async () => {
                              for (const accountId of selectedAccountIds) {
                                await deleteProviderAccount({
                                  accountId,
                                  providerId: selectedProvider.id,
                                });
                              }
                              setSelectedAccountIds([]);
                            }).catch((error) => {
                              Alert.alert(
                                "Accounts could not be deleted",
                                error instanceof Error
                                  ? error.message
                                  : "Please try again.",
                              );
                            });
                          },
                        },
                      ],
                    );
                  }}
                  textClassName="text-destructive-foreground dark:text-destructive-foreground-dark"
                  variant="destructive"
                >
                  {selectedAccountIds.length > 1
                    ? `Delete ${selectedAccountIds.length} accounts`
                    : "Delete account"}
                </Button>
              </DrawerFooter>
            ) : (
              <DrawerFooter>
                <Button
                  onPress={() => {
                    setNewAccountLabel("");
                    setNewAccountApiKey("");
                    setAddingAccount(true);
                  }}
                >
                  Add account
                </Button>
              </DrawerFooter>
            )}
          </DrawerContent>
        ) : null}
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          setAddingAccount(open);
          if (!open) {
            setNewAccountLabel("");
            setNewAccountApiKey("");
          }
        }}
        open={addingAccount}
      >
        {selectedProvider ? (
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>Add account</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
              <Input
                autoCapitalize="words"
                onChangeText={setNewAccountLabel}
                placeholder="Account label"
                value={newAccountLabel}
              />
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setNewAccountApiKey}
                placeholder="API key"
                secureTextEntry
                value={newAccountApiKey}
              />
            </DrawerBody>
            <DrawerFooter>
              <Button
                disabled={!newAccountLabel.trim() || !newAccountApiKey.trim()}
                loading={busyKey !== null}
                onPress={() => {
                  const label = newAccountLabel.trim() || "Account";
                  const apiKey = newAccountApiKey.trim();
                  void runAction(
                    `add-account:${selectedProvider.id}`,
                    async () => {
                      await createProviderAccount({
                        apiKey,
                        label,
                        providerId: selectedProvider.id,
                      });
                      setAddingAccount(false);
                      setNewAccountLabel("");
                      setNewAccountApiKey("");
                    },
                  ).catch((error) => {
                    Alert.alert(
                      "Account could not be added",
                      error instanceof Error
                        ? error.message
                        : "Please try again.",
                    );
                  });
                }}
              >
                Add account
              </Button>
            </DrawerFooter>
          </DrawerContent>
        ) : null}
      </Drawer>
    </Container>
  );
}

function AccountSelectRow({
  active,
  onLongPress,
  onPress,
  selectedForDelete,
  selectedMode,
  title,
}: {
  active: boolean;
  onLongPress: () => void;
  onPress: () => void;
  selectedForDelete: boolean;
  selectedMode: boolean;
  title: string;
}) {
  const theme = useTheme();
  const highlighted = selectedForDelete;

  return (
    <View
      className={cn(
        "flex-row items-center gap-sp-3 rounded-ui border px-sp-4 py-sp-3",
        highlighted
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
    >
      <Pressable
        accessibilityRole="button"
        className="min-w-0 flex-1 flex-row items-center gap-sp-3"
        onLongPress={onLongPress}
        onPress={onPress}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
      >
        {selectedMode ? (
          <View className="h-5 w-5 shrink-0 items-center justify-center">
            {selectedForDelete ? (
              <Check color={theme.text} size={16} />
            ) : null}
          </View>
        ) : null}
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {title}
        </Text>
        {active ? (
          <Text className="ml-auto font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Active
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function AccountManager({
  accounts,
  activeAccountId,
  busy,
  onEnterSelectionMode,
  onPress,
  selectedAccountIds,
}: {
  accounts: ProviderAccount[];
  activeAccountId: string | null;
  busy: boolean;
  onEnterSelectionMode: (accountId: string) => void;
  onPress: (accountId: string) => void;
  selectedAccountIds: string[];
}) {
  const selectedMode = selectedAccountIds.length > 0;

  return (
    <View className="gap-sp-2">
      {accounts.length === 0 ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          No accounts yet.
        </Text>
      ) : (
        accounts.map((account) => (
          <AccountSelectRow
            active={account.id === activeAccountId}
            key={account.id}
            onLongPress={() => {
              if (!busy) {
                onEnterSelectionMode(account.id);
              }
            }}
            onPress={() => {
              if (!busy) {
                onPress(account.id);
              }
            }}
            selectedForDelete={selectedAccountIds.includes(account.id)}
            selectedMode={selectedMode}
            title={account.label}
          />
        ))
      )}
    </View>
  );
}

function SettingsLinkRow({
  chevronColor,
  label,
  onPress,
  value,
}: {
  chevronColor: string;
  label: string;
  onPress: () => void;
  value?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
    >
      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {value ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {value}
        </Text>
      ) : null}
      <ChevronRight color={chevronColor} size={18} />
    </Pressable>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <Text className="max-w-40 text-right font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {value}
      </Text>
    </View>
  );
}

function buildCapabilityBadges(
  model: CuratedModelDefinition | ResolvedModel | null,
) {
  if (!model) {
    return [];
  }

  const badges: string[] = [];

  const capabilities = model.capabilities ?? {};

  if ("isFree" in model && model.isFree) {
    badges.push("Free");
  }

  if (("supportsTools" in model && model.supportsTools) || capabilities.tools) {
    badges.push("Tools");
  }

  if (
    ("supportsImageInput" in model && model.supportsImageInput) ||
    capabilities.imageInput
  ) {
    badges.push("Image input");
  }

  if (
    ("supportsImageGeneration" in model && model.supportsImageGeneration) ||
    capabilities.imageGeneration
  ) {
    badges.push("Image output");
  }

  return badges;
}

function OnDeviceModelRow({
  checkColor,
  current,
  downloadProgress,
  info,
  label,
  loading,
  memoryConstrained,
  onActivate,
  onCancel,
  onDelete,
  onDownload,
  onToolsModeChange,
  toolsForcedOn,
  toolsSupported,
}: {
  checkColor: string;
  current: boolean;
  downloadProgress?: number;
  info: DownloadableModel | null;
  label: string;
  loading: boolean;
  memoryConstrained: boolean;
  onActivate: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onToolsModeChange: () => void;
  toolsForcedOn: boolean;
  toolsSupported: boolean;
}) {
  const downloading =
    downloadProgress !== undefined || info?.status === "downloading";
  const installed =
    info?.status === "downloaded" ||
    info?.status === "loading" ||
    info?.status === "ready";
  const progressLabel = `${Math.round((downloadProgress ?? 0) * 100)}%`;

  return (
    <View className="gap-sp-3 px-sp-4 py-sp-3">
      <View className="flex-row items-start gap-sp-3">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-sp-2">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              {label}
            </Text>
            {toolsSupported ? (
              <View className="rounded-full border border-border px-2 py-0.5 dark:border-border-dark">
                <Text className="font-sans text-[11px] text-muted-foreground dark:text-muted-foreground-dark">
                  Tools
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {info
              ? `${info.parameterCount} parameters - ${formatBytes(info.sizeBytes)} - ${info.contextWindow.toLocaleString()} token context`
              : "Checking device support..."}
          </Text>
        </View>
        {current ? <Check color={checkColor} size={18} /> : null}
      </View>

      {downloading ? (
        <View className="gap-sp-2">
          <View className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-muted-dark">
            <View
              className="h-full rounded-full bg-foreground dark:bg-foreground-dark"
              style={{
                width: `${Math.max(2, Math.round((downloadProgress ?? 0) * 100))}%`,
              }}
            />
          </View>
          <View className="flex-row items-center justify-between gap-sp-3">
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Downloading {progressLabel}
            </Text>
            <Button onPress={onCancel} size="xs" variant="outline">
              Cancel
            </Button>
          </View>
        </View>
      ) : installed ? (
        <View className="gap-sp-2">
          <View className="flex-row gap-sp-2">
            <Button
              className="flex-1"
              disabled={current}
              loading={loading}
              onPress={onActivate}
              size="sm"
              variant="secondary"
            >
              {current ? "Current" : "Use model"}
            </Button>
            <Button
              disabled={loading}
              onPress={onDelete}
              size="sm"
              variant="outline"
            >
              Delete
            </Button>
          </View>
          {memoryConstrained && toolsSupported ? (
            <View className="flex-row items-center gap-sp-2 px-1">
              <Text className="flex-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {toolsForcedOn
                  ? "Tools enabled; reduced context remains."
                  : "Tools disabled to reduce memory use."}
              </Text>
              <Button
                disabled={loading}
                onPress={onToolsModeChange}
                size="xs"
                variant="ghost"
              >
                {toolsForcedOn ? "Use auto" : "Enable"}
              </Button>
            </View>
          ) : null}
        </View>
      ) : (
        <View className="gap-sp-1">
          <Button
            disabled={!info}
            loading={loading}
            onPress={onDownload}
            size="sm"
            variant="secondary"
          >
            {info ? `Download ${formatBytes(info.sizeBytes)}` : "Unavailable"}
          </Button>
          {info && !info.meetsRequirements ? (
            <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
              Recommended RAM: at least {formatBytes(info.minRamBytes)}. It may
              be slow or unstable on this device.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  }

  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function ProviderModelRow({
  capabilityBadges,
  checkColor,
  current = false,
  label,
  modelId,
  onPress,
  stateLabel,
}: {
  capabilityBadges: string[];
  checkColor: string;
  current?: boolean;
  label: string;
  modelId: string;
  onPress: () => void;
  stateLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
    >
      <View className="flex-1 gap-1">
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {modelId}
        </Text>
        {capabilityBadges.length > 0 ? (
          <View className="flex-row flex-wrap gap-1 pt-1">
            {capabilityBadges.map((badge) => (
              <View
                key={badge}
                className="rounded-full border border-border px-2 py-1 dark:border-border-dark"
              >
                <Text className="font-sans text-[11px] text-muted-foreground dark:text-muted-foreground-dark">
                  {badge}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <Text
        className={cn(
          "font-sans text-sm",
          current
            ? "text-foreground dark:text-foreground-dark"
            : "text-muted-foreground dark:text-muted-foreground-dark",
        )}
      >
        {stateLabel}
      </Text>
      {current ? <Check color={checkColor} size={18} /> : null}
    </Pressable>
  );
}
