import { useRouter } from "expo-router";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
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
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { invalidateLiveModelCatalog } from "@/lib/config/live-model-catalog";
import { fetchOnDeviceModelCatalogCached } from "@/lib/on-device/catalog";
import {
    cancelPersistentModelDownload,
    getPersistentModelDownloadStatus,
    isPersistentModelDownloadActive,
    preparePersistentModelDownloadNotifications,
    startPersistentModelDownload,
    type PersistentModelDownloadState,
} from "@/lib/on-device/model-download";
import { cn } from "@/lib/utils";
import {
    createModelRef,
    type CuratedModelDefinition,
    type ModelRef,
    type ProviderConfig,
    type ResolvedModel,
} from "@/types/app-state";

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
    const {
        activeProviderIds,
        availableModels,
        clearProviderApiKey,
        connectOpenAIOAuth,
        createModelPreset,
        currentModel,
        disconnectOpenAIOAuth,
        providers,
        providerModelDiscovery,
        refresh,
        saveProviderApiKey,
        selectModel,
        suggestedModelsByProvider,
        updateProvider,
    } = useConfig();
    const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [baseUrlInput, setBaseUrlInput] = useState("");
    const [customModelId, setCustomModelId] = useState("");
    const [modelQuery, setModelQuery] = useState("");
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [onDeviceModels, setOnDeviceModels] = useState<DownloadableModel[]>(
        [],
    );
    const [onDeviceError, setOnDeviceError] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<
        Record<string, number>
    >({});
    const downloadStateRef = useRef<
        Record<string, PersistentModelDownloadState>
    >({});
    const onDeviceModelIdsRef = useRef<string[]>([]);

    const loadOnDeviceModels = useCallback(async () => {
        if (Platform.OS === "web") {
            setOnDeviceModels([]);
            setOnDeviceError(
                "On-device models are available on Android and iOS.",
            );
            return;
        }

        try {
            const catalogModels = await fetchOnDeviceModelCatalogCached();
            const catalogIds = new Set(catalogModels.map((model) => model.id));
            onDeviceModelIdsRef.current = [...catalogIds];
            const { getDownloadableModels } = await import("expo-ai-kit");
            const models = await getDownloadableModels();

            setOnDeviceModels(
                models.filter((model) => catalogIds.has(model.id)),
            );
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
                        : provider.family === "ollama" &&
                            discovery?.status === "failed"
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
    }, [loadOnDeviceModels, selectedProvider?.family]);
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
                models: displayModels.filter(
                    (model) => model.outputType !== "image",
                ),
            },
            {
                label: "Image models",
                models: displayModels.filter(
                    (model) => model.outputType === "image",
                ),
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

    const downloadOnDeviceModel = async (modelId: string, label: string) => {
        setOnDeviceError(null);
        setDownloadProgress((current) => ({ ...current, [modelId]: 0 }));

        try {
            if (Platform.OS === "android") {
                const notificationsGranted =
                    await preparePersistentModelDownloadNotifications();
                const status = await startPersistentModelDownload(
                    modelId,
                    label,
                );
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
                    error instanceof Error
                        ? error.message
                        : "The model download failed.",
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

    const activateOnDeviceModel = async (modelId: string) => {
        setOnDeviceError(null);

        try {
            const { setModel } = await import("expo-ai-kit");
            await setModel(modelId, { backend: "auto" });
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
                            const {
                                deleteModel,
                                getDownloadableModels,
                                setModel,
                            } = await import("expo-ai-kit");
                            if (Platform.OS === "android") {
                                await cancelPersistentModelDownload(modelId);
                            }
                            await deleteModel(modelId);
                            const catalogIds = new Set(
                                onDeviceModelIdsRef.current,
                            );
                            const remaining = (
                                await getDownloadableModels()
                            ).filter(
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
                                currentModel?.ref ===
                                createModelRef("on-device", modelId)
                            ) {
                                await setModel(remaining[0].id, {
                                    backend: "auto",
                                });
                                await selectModel(
                                    createModelRef(
                                        "on-device",
                                        remaining[0].id,
                                    ),
                                );
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
            </View>

            <Card className="overflow-hidden">
                {providerItems.map((provider, index) => (
                    <View key={provider.key}>
                        {index > 0 ? <Separator /> : null}
                        <SettingsLinkRow
                            chevronColor={theme.textSecondary}
                            label={provider.label}
                            onPress={() => {
                                setApiKeyInput("");
                                setBaseUrlInput(
                                    provider.provider.baseUrl ?? "",
                                );
                                setCustomModelId("");
                                setModelQuery("");
                                setSelectedItemKey(provider.key);
                            }}
                            value={provider.value}
                        />
                    </View>
                ))}
            </Card>

            <Drawer
                onOpenChange={(open) => {
                    if (!open) {
                        setSelectedItemKey(null);
                        setApiKeyInput("");
                        setBaseUrlInput("");
                        setCustomModelId("");
                        setModelQuery("");
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
                                            selectedProvider?.family ===
                                            "ollama"
                                                ? selectedProviderDiscovery?.status ===
                                                  "connected"
                                                    ? "Connected"
                                                    : selectedProviderDiscovery?.status ===
                                                        "failed"
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
                                    <StatusRow
                                        label="Family"
                                        value={selectedProvider.family}
                                    />
                                    {currentModel?.providerId ===
                                    selectedProvider.id ? (
                                        <>
                                            <Separator />
                                            <StatusRow
                                                label="Current model"
                                                value={currentModel.label}
                                            />
                                        </>
                                    ) : null}
                                </View>

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
                                                disabled={
                                                    !selectedProviderActive
                                                }
                                                onPress={() => {
                                                    void updateProvider(
                                                        "on-device",
                                                        { enabled: false },
                                                    );
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
                                                {
                                                    selectedProvider.oauthAccountEmail
                                                }
                                            </Text>
                                        ) : null}
                                        <View className="flex-row gap-sp-2">
                                            <Button
                                                className="flex-1"
                                                loading={
                                                    busyKey ===
                                                    `connect:${selectedProvider.id}`
                                                }
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
                                                    busyKey ===
                                                    `disconnect:${selectedProvider.id}`
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
                                ) : selectedProvider.authType === "none" ? (
                                    <View className="gap-sp-3">
                                        <Input
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            keyboardType="url"
                                            onChangeText={setBaseUrlInput}
                                            placeholder="Ollama server URL"
                                            value={baseUrlInput}
                                        />
                                        <Input
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            onChangeText={setApiKeyInput}
                                            placeholder="API key (optional)"
                                            secureTextEntry
                                            value={apiKeyInput}
                                        />
                                        <View className="flex-row gap-sp-2">
                                            <Button
                                                className="flex-1"
                                                disabled={!baseUrlInput.trim()}
                                                loading={
                                                    busyKey ===
                                                    `connect:${selectedProvider.id}`
                                                }
                                                onPress={() => {
                                                    runAction(
                                                        `connect:${selectedProvider.id}`,
                                                        async () => {
                                                            if (
                                                                apiKeyInput.trim()
                                                            ) {
                                                                await saveProviderApiKey(
                                                                    selectedProvider.id,
                                                                    apiKeyInput.trim(),
                                                                );
                                                                setApiKeyInput(
                                                                    "",
                                                                );
                                                            }
                                                            await updateProvider(
                                                                selectedProvider.id,
                                                                {
                                                                    baseUrl:
                                                                        baseUrlInput.trim(),
                                                                    enabled: true,
                                                                },
                                                            );
                                                        },
                                                    ).catch(console.error);
                                                }}
                                                variant="secondary"
                                            >
                                                Connect
                                            </Button>
                                            <Button
                                                className="flex-1"
                                                loading={
                                                    busyKey ===
                                                    `disconnect:${selectedProvider.id}`
                                                }
                                                onPress={() => {
                                                    runAction(
                                                        `disconnect:${selectedProvider.id}`,
                                                        async () => {
                                                            await updateProvider(
                                                                selectedProvider.id,
                                                                {
                                                                    enabled: false,
                                                                },
                                                            );
                                                        },
                                                    ).catch(console.error);
                                                }}
                                                variant="outline"
                                            >
                                                Disconnect
                                            </Button>
                                        </View>
                                        <Button
                                            loading={
                                                busyKey ===
                                                `clear:${selectedProvider.id}`
                                            }
                                            onPress={() => {
                                                runAction(
                                                    `clear:${selectedProvider.id}`,
                                                    async () => {
                                                        await clearProviderApiKey(
                                                            selectedProvider.id,
                                                        );
                                                        setApiKeyInput("");
                                                    },
                                                ).catch(console.error);
                                            }}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            Clear saved API key
                                        </Button>
                                    </View>
                                ) : (
                                    <View className="gap-sp-3">
                                        <Input
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            onChangeText={setApiKeyInput}
                                            placeholder="API key"
                                            secureTextEntry
                                            value={apiKeyInput}
                                        />
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
                                                    !apiKeyInput.trim() ||
                                                    (selectedProviderNeedsBaseUrl &&
                                                        !baseUrlInput.trim())
                                                }
                                                loading={
                                                    busyKey ===
                                                    `save:${selectedProvider.id}`
                                                }
                                                onPress={() => {
                                                    runAction(
                                                        `save:${selectedProvider.id}`,
                                                        async () => {
                                                            const normalizedBaseUrl =
                                                                baseUrlInput.trim();
                                                            await updateProvider(
                                                                selectedProvider.id,
                                                                {
                                                                    baseUrl:
                                                                        normalizedBaseUrl ||
                                                                        (selectedProviderNeedsBaseUrl
                                                                            ? null
                                                                            : selectedProvider.baseUrl),
                                                                    label: selectedItem.label,
                                                                },
                                                            );

                                                            await saveProviderApiKey(
                                                                selectedProvider.id,
                                                                apiKeyInput.trim(),
                                                            );
                                                            setApiKeyInput("");
                                                        },
                                                    ).catch(console.error);
                                                }}
                                                variant="secondary"
                                            >
                                                Save
                                            </Button>
                                            <Button
                                                className="flex-1"
                                                loading={
                                                    busyKey ===
                                                    `clear:${selectedProvider.id}`
                                                }
                                                onPress={() => {
                                                    runAction(
                                                        `clear:${selectedProvider.id}`,
                                                        async () => {
                                                            await clearProviderApiKey(
                                                                selectedProvider.id,
                                                            );
                                                            setApiKeyInput("");
                                                        },
                                                    ).catch(console.error);
                                                }}
                                                variant="outline"
                                            >
                                                Clear
                                            </Button>
                                        </View>
                                    </View>
                                )}

                                <View className="gap-sp-3">
                                    <View className="flex-row items-center justify-between gap-sp-3">
                                        <Text className="flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                                            {selectedProvider.family ===
                                            "on-device"
                                                ? "Downloaded models stay on this device"
                                                : selectedProvider.authType ===
                                                    "oauth"
                                                  ? "Models supported by ChatGPT OAuth"
                                                  : "Models from live provider catalogs"}
                                        </Text>
                                        {selectedProvider.authType ===
                                            "apiKey" ||
                                        selectedProvider.family === "ollama" ? (
                                            <Button
                                                loading={
                                                    busyKey ===
                                                    `refresh-models:${selectedProvider.id}`
                                                }
                                                onPress={() => {
                                                    runAction(
                                                        `refresh-models:${selectedProvider.id}`,
                                                        async () => {
                                                            invalidateLiveModelCatalog();
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
                                    {selectedProvider.id !==
                                        "openai-compatible" ||
                                    selectedItem.models.length > 0 ? (
                                        <Input
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            onChangeText={setModelQuery}
                                            placeholder="Search models"
                                            value={modelQuery}
                                        />
                                    ) : null}

                                    {selectedProvider.id ===
                                    "openai-compatible" ? (
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
                                                    !customModelId.trim() ||
                                                    !selectedProviderActive
                                                }
                                                loading={
                                                    busyKey ===
                                                    `custom-model:${selectedProvider.id}:${customModelId.trim()}`
                                                }
                                                onPress={() => {
                                                    const modelId =
                                                        customModelId.trim();
                                                    runAction(
                                                        `custom-model:${selectedProvider.id}:${modelId}`,
                                                        async () => {
                                                            await createModelPreset(
                                                                {
                                                                    label: modelId,
                                                                    makeDefault:
                                                                        selectedProviderModels.length ===
                                                                        0,
                                                                    modelId,
                                                                    providerId:
                                                                        selectedProvider.id,
                                                                    select: true,
                                                                },
                                                            );
                                                            setCustomModelId(
                                                                "",
                                                            );
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
                                            {displayModels.map(
                                                (model, index) => {
                                                    const info =
                                                        onDeviceModels.find(
                                                            (item) =>
                                                                item.id ===
                                                                model.id,
                                                        ) ?? null;
                                                    const modelRef =
                                                        createModelRef(
                                                            selectedProvider.id,
                                                            model.id,
                                                        ) as ModelRef;

                                                    return (
                                                        <View key={model.id}>
                                                            {index > 0 ? (
                                                                <Separator />
                                                            ) : null}
                                                            <OnDeviceModelRow
                                                                checkColor={
                                                                    theme.text
                                                                }
                                                                current={
                                                                    currentModel?.ref ===
                                                                    modelRef
                                                                }
                                                                downloadProgress={
                                                                    downloadProgress[
                                                                        model.id
                                                                    ]
                                                                }
                                                                info={info}
                                                                label={
                                                                    model.label
                                                                }
                                                                loading={
                                                                    busyKey ===
                                                                        `model:${model.id}` ||
                                                                    busyKey ===
                                                                        `delete-model:${model.id}` ||
                                                                    busyKey ===
                                                                        `download-model:${model.id}`
                                                                }
                                                                onActivate={() => {
                                                                    void runAction(
                                                                        `model:${model.id}`,
                                                                        () =>
                                                                            activateOnDeviceModel(
                                                                                model.id,
                                                                            ),
                                                                    );
                                                                }}
                                                                onCancel={() => {
                                                                    void cancelOnDeviceDownload(
                                                                        model.id,
                                                                    ).catch(
                                                                        (
                                                                            error,
                                                                        ) => {
                                                                            setOnDeviceError(
                                                                                error instanceof
                                                                                    Error
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
                                                                    void runAction(
                                                                        `download-model:${model.id}`,
                                                                        () =>
                                                                            downloadOnDeviceModel(
                                                                                model.id,
                                                                                model.label,
                                                                            ),
                                                                    );
                                                                }}
                                                            />
                                                        </View>
                                                    );
                                                },
                                            )}
                                        </View>
                                    ) : displayModels.length > 0 ? (
                                        modelSections.map((section) =>
                                            section.models.length > 0 ? (
                                                <View
                                                    className="gap-sp-2"
                                                    key={section.label}
                                                >
                                                    <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                                                        {section.label}
                                                    </Text>
                                                    <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                                                        {section.models.map(
                                                            (model, index) => {
                                                                const modelRef =
                                                                    createModelRef(
                                                                        selectedProvider.id,
                                                                        model.id,
                                                                    ) as ModelRef;
                                                                const resolvedModel =
                                                                    selectedProviderModels.find(
                                                                        (
                                                                            item,
                                                                        ) =>
                                                                            item.ref ===
                                                                            modelRef,
                                                                    ) ?? null;
                                                                const current =
                                                                    currentModel?.ref ===
                                                                    modelRef;

                                                                return (
                                                                    <View
                                                                        key={
                                                                            model.id
                                                                        }
                                                                    >
                                                                        {index >
                                                                        0 ? (
                                                                            <Separator />
                                                                        ) : null}
                                                                        <ProviderModelRow
                                                                            capabilityBadges={buildCapabilityBadges(
                                                                                resolvedModel ??
                                                                                    model,
                                                                            ).concat(
                                                                                selectedProvider.family ===
                                                                                    "ollama" &&
                                                                                    model
                                                                                        .options
                                                                                        ?.ollama
                                                                                    ? [
                                                                                          "Pulled",
                                                                                      ]
                                                                                    : [],
                                                                            )}
                                                                            checkColor={
                                                                                theme.text
                                                                            }
                                                                            current={
                                                                                current
                                                                            }
                                                                            label={
                                                                                model.label
                                                                            }
                                                                            modelId={
                                                                                model.id
                                                                            }
                                                                            onPress={() => {
                                                                                runAction(
                                                                                    `model:${selectedProvider.id}:${model.id}`,
                                                                                    async () => {
                                                                                        if (
                                                                                            !current &&
                                                                                            selectedProviderActive
                                                                                        ) {
                                                                                            await selectModel(
                                                                                                modelRef,
                                                                                            );
                                                                                        }
                                                                                    },
                                                                                ).catch(
                                                                                    console.error,
                                                                                );
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
                                                            },
                                                        )}
                                                    </View>
                                                </View>
                                            ) : null,
                                        )
                                    ) : (
                                        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                                            {selectedProvider.family ===
                                                "ollama" &&
                                            selectedProviderDiscovery?.status ===
                                                "connected"
                                                ? "Connected, but no pulled models were found. Pull a model in Ollama, then tap Refresh."
                                                : selectedProvider.family ===
                                                    "ollama"
                                                  ? "Connect to Ollama to load pulled models."
                                                  : "No models found"}
                                        </Text>
                                    )}
                                </View>
                            </DrawerBody>
                            <DrawerFooter>
                                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                                    {selectedProvider.family === "on-device"
                                        ? "Downloads are verified and stored only on this device."
                                        : "Models from configured providers are available automatically."}
                                </Text>
                            </DrawerFooter>
                        </>
                    ) : null}
                </DrawerContent>
            </Drawer>
        </Container>
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

    if (
        ("supportsTools" in model && model.supportsTools) ||
        capabilities.tools
    ) {
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
    onActivate,
    onCancel,
    onDelete,
    onDownload,
}: {
    checkColor: string;
    current: boolean;
    downloadProgress?: number;
    info: DownloadableModel | null;
    label: string;
    loading: boolean;
    onActivate: () => void;
    onCancel: () => void;
    onDelete: () => void;
    onDownload: () => void;
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
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                        {label}
                    </Text>
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {info
                            ? `${info.parameterCount} parameters - ${formatBytes(info.sizeBytes)} - ${info.contextWindow.toLocaleString()} token context`
                            : "Checking device support..."}
                    </Text>
                    <View className="flex-row flex-wrap gap-1 pt-1">
                        {["Offline", "Tools", info?.license]
                            .filter((badge): badge is string => Boolean(badge))
                            .map((badge) => (
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
                <View className="flex-row gap-sp-2">
                    <Button
                        className="flex-1"
                        disabled={current}
                        loading={loading}
                        onPress={onActivate}
                        size="sm"
                        variant="secondary"
                    >
                        {current ? "Current" : "Use offline"}
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
            ) : (
                <View className="gap-sp-1">
                    <Button
                        disabled={!info?.meetsRequirements}
                        loading={loading}
                        onPress={onDownload}
                        size="sm"
                        variant="secondary"
                    >
                        {info
                            ? `Download ${formatBytes(info.sizeBytes)}`
                            : "Unavailable"}
                    </Button>
                    {info && !info.meetsRequirements ? (
                        <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                            This model needs at least{" "}
                            {formatBytes(info.minRamBytes)} of RAM.
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
