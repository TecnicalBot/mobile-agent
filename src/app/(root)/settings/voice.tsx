import { useRouter } from "expo-router";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/core/utils";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { DrawerPager, DrawerPagerPage } from "@/components/ui/drawer-pager";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/use-theme";
import {
  cancelVoiceDownload,
  deleteVoiceModel,
  downloadVoiceModel,
  getModelLanguages,
  isModelDownloaded,
  loadVoiceEngine,
  loadVoiceLanguage,
  refreshVoiceModels,
  saveVoiceEngine,
  saveVoiceLanguage,
  type VoiceCatalogModel,
  type VoiceEngine,
  type WhisperLanguage,
} from "@/modules/voice/models";
import {
  cancelPersistentVoiceDownload,
  getPersistentVoiceDownloadStatus,
  isPersistentModelDownloadActive,
  prepareVoiceDownloadNotifications,
  startPersistentVoiceDownload,
  supportsPersistentVoiceDownloads,
  type PersistentModelDownloadStatus,
} from "@/modules/voice/persistent-download";

function formatBytes(bytes: number) {
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export default function VoiceSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [engine, setEngine] = useState<VoiceEngine>("system");
  const [models, setModels] = useState<VoiceCatalogModel[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [language, setLanguage] = useState<WhisperLanguage>("en");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const percentDownloaded = Math.round(
    Math.min(Math.max(progress, 0), 1) * 100,
  );
  const persistentRef = useRef(false);
  // WorkManager only exposes a new request a moment after enqueueing. Ignore
  // history until the exact request id is known so a finished record from an
  // earlier attempt cannot clear the button.
  const startingRef = useRef(false);
  const workIdRef = useRef<string | null>(null);
  const supported = Platform.OS === "android" || Platform.OS === "ios";

  const refresh = useCallback(async () => {
    if (!supported) return;
    const [currentEngine, catalog] = await Promise.all([
      loadVoiceEngine(),
      refreshVoiceModels(),
    ]);
    setEngine(currentEngine);
    setModels(catalog);
    setInstalled(
      catalog
        .filter((model) => isModelDownloaded(model.id))
        .map((model) => model.id),
    );

    // Re-attach to a download that survived leaving this screen (or an app
    // restart) so its progress is visible when the user comes back.
    if (!supportsPersistentVoiceDownloads()) return;
    const statuses = await Promise.all(
      catalog.map(async (model) => {
        try {
          return { model, status: await getPersistentVoiceDownloadStatus(model) };
        } catch {
          return null;
        }
      }),
    );
    const active = statuses.find(
      (
        entry,
      ): entry is {
        model: VoiceCatalogModel;
        status: PersistentModelDownloadStatus;
      } => entry !== null && isPersistentModelDownloadActive(entry.status),
    );
    if (active) {
      persistentRef.current = true;
      workIdRef.current = active.status.workId ?? null;
      setBusy(active.model.id);
      setProgress(active.status.progress);
    }
  }, [supported]);

  useEffect(() => {
    refresh().catch((error: unknown) =>
      Alert.alert("Voice settings", String(error)),
    );
    return () => {
      // Inline downloads are scoped to this screen. WorkManager-backed ones
      // deliberately keep running in the background.
      if (!persistentRef.current) {
        cancelVoiceDownload().catch(console.error);
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedKey || selectedKey === "system") return;
    let disposed = false;
    loadVoiceLanguage(selectedKey)
      .then((value) => {
        if (!disposed) setLanguage(value);
      })
      .catch(console.error);
    return () => {
      disposed = true;
    };
  }, [selectedKey]);

  useEffect(() => {
    if (!busy || !persistentRef.current) return;
    const model = models.find((item) => item.id === busy);
    if (!model) return;

    let disposed = false;
    const sync = async () => {
      // The component already shows a spinner while start() runs; do not ask
      // WorkManager for a status yet, or it may answer with an old cancelled
      // record and snap the button back to "Download".
      if (startingRef.current) return;
      try {
        const status = await getPersistentVoiceDownloadStatus(
          model,
          workIdRef.current,
        );
        if (disposed) return;
        if (status.workId) workIdRef.current = status.workId;
        setProgress(status.progress);
        if (isPersistentModelDownloadActive(status)) return;

        // WorkManager can briefly report no work right after enqueueing, before
        // the first progress write lands. Treat "idle" as still starting so the
        // button doesn't snap back to "Download" while the download runs.
        if (status.state === "idle") return;

        persistentRef.current = false;
        workIdRef.current = null;
        setBusy(null);
        if (status.state === "succeeded") {
          setProgress(1);
          await refresh();
        } else if (status.state === "failed") {
          Alert.alert(
            "Download failed",
            status.error ?? "The model download failed.",
          );
        } else if (status.state === "cancelled") {
          setProgress(0);
        }
      } catch (error) {
        if (disposed) return;
        persistentRef.current = false;
        workIdRef.current = null;
        setBusy(null);
        Alert.alert(
          "Voice settings",
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    void sync();
    const interval = setInterval(() => void sync(), 1500);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [busy, models, refresh]);

  const selectEngine = async (next: VoiceEngine) => {
    try {
      await saveVoiceEngine(next);
      setEngine(next);
    } catch (error) {
      Alert.alert(
        "Voice settings",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const download = async (id: string) => {
    const model = models.find((item) => item.id === id);
    if (!model) return;

    setBusy(id);
    setProgress(0);
    persistentRef.current = false;
    startingRef.current = false;
    workIdRef.current = null;
    try {
      if (supportsPersistentVoiceDownloads()) {
        startingRef.current = true;
        persistentRef.current = true;
        const notificationsGranted = await prepareVoiceDownloadNotifications();
        const status = await startPersistentVoiceDownload(model);
        workIdRef.current = status.workId ?? null;
        startingRef.current = false;
        setProgress(status.progress);
        if (status.state === "succeeded") {
          persistentRef.current = false;
          workIdRef.current = null;
          setProgress(1);
          await refresh();
          setBusy(null);
          return;
        }
        if (status.state === "failed") {
          throw new Error(status.error ?? "The model download failed.");
        }
        if (!notificationsGranted) {
          Alert.alert(
            "Notifications are off",
            "The download continues in the background, but its progress notification stays hidden. Enable notifications for Mobile Agent to see it.",
          );
        }
      } else {
        await downloadVoiceModel(id, setProgress);
        await refresh();
        setBusy(null);
      }
    } catch (error) {
      startingRef.current = false;
      workIdRef.current = null;
      persistentRef.current = false;
      setBusy(null);
      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const cancelDownload = async () => {
    if (!busy) return;
    const persistent = persistentRef.current;
    persistentRef.current = false;
    startingRef.current = false;
    try {
      if (persistent) {
        await cancelPersistentVoiceDownload(busy);
        workIdRef.current = null;
        setBusy(null);
        setProgress(0);
      } else {
        await cancelVoiceDownload();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const remove = (id: string, label: string) =>
    Alert.alert(
      `Delete ${label}?`,
      "The model can be downloaded again. If it is selected, voice input will switch to System.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteVoiceModel(id)
              .then(refresh)
              .catch((error: unknown) =>
                Alert.alert("Delete failed", String(error)),
              );
          },
        },
      ],
    );

  const selectedModel =
    models.find((model) => model.id === selectedKey) ?? null;
  const selectedIsSystem = selectedKey === "system";
  const languageOptions = useMemo(
    () => (selectedKey ? getModelLanguages(selectedKey) : []),
    [selectedKey],
  );
  const languageLabel =
    languageOptions.find((item) => item.id === language)?.label ?? "English";

  const rowValue = (id: string) => (engine === id ? "Selected" : "Setup");

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={() => router.back()}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Voice input
        </Text>
      </View>

      {!supported ? (
        <Text className="px-sp-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Local Whisper requires Android or iOS.
        </Text>
      ) : null}

      <Card className="overflow-hidden">
        <VoiceLinkRow
          label="System"
          onPress={() => {
            setPage(0);
            setSelectedKey("system");
          }}
          value={engine === "system" ? "Selected" : "Setup"}
        />
        {models.map((model) => (
          <View key={model.id}>
            <Separator />
            <VoiceLinkRow
              label={model.label}
              onPress={() => {
                setPage(0);
                setSelectedKey(model.id);
              }}
              value={rowValue(model.id)}
            />
          </View>
        ))}
      </Card>

      <Drawer
        onOpenChange={(open) => {
          if (!open) {
            setSelectedKey(null);
            setPage(0);
          }
        }}
        open={selectedKey !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerPager onPageChange={setPage} page={page}>
            <DrawerPagerPage>
              <DrawerHeader>
                <DrawerTitle>
                  {selectedIsSystem
                    ? "System"
                    : (selectedModel?.label ?? "Model")}
                </DrawerTitle>
              </DrawerHeader>

              <DrawerBody contentContainerClassName="gap-sp-4 pb-sp-4">
                {selectedIsSystem ? (
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Uses your device’s speech recognizer. Best accuracy, and the
                    language follows your device settings.
                  </Text>
                ) : null}

                {selectedModel ? (
                  <View className="overflow-hidden rounded-card border border-border dark:border-border-dark">
                    <DetailRow
                      label="Status"
                      value={
                        engine === selectedModel.id
                          ? "Selected"
                          : installed.includes(selectedModel.id)
                            ? "Downloaded"
                            : "Not downloaded"
                      }
                    />
                    <Separator />
                    <DetailRow
                      label="Size"
                      value={formatBytes(selectedModel.sizeBytes)}
                    />
                  </View>
                ) : null}

                {!selectedIsSystem ? (
                  <DrawerLinkRow
                    label="Language"
                    onPress={() => setPage(1)}
                    value={languageLabel}
                  />
                ) : null}

                {selectedModel && busy === selectedModel.id ? (
                  <View className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-muted-dark">
                    <View
                      className="h-full rounded-full bg-foreground dark:bg-foreground-dark"
                      style={{
                        width: `${Math.max(2, percentDownloaded)}%`,
                      }}
                    />
                  </View>
                ) : null}
              </DrawerBody>

              <DrawerFooter>
                {selectedIsSystem ? (
                  <Button
                    disabled={engine === "system"}
                    onPress={() => {
                      selectEngine("system").catch(console.error);
                    }}
                  >
                    {engine === "system" ? "Selected" : "Use System"}
                  </Button>
                ) : selectedModel ? (
                  installed.includes(selectedModel.id) ? (
                    <View className="flex-row gap-sp-2">
                      <Button
                        className="flex-1"
                        disabled={busy !== null || engine === selectedModel.id}
                        onPress={() => {
                          selectEngine(selectedModel.id).catch(console.error);
                        }}
                      >
                        {engine === selectedModel.id ? "Selected" : "Use model"}
                      </Button>
                      <Button
                        disabled={busy !== null}
                        onPress={() =>
                          remove(selectedModel.id, selectedModel.label)
                        }
                        variant="outline"
                      >
                        Delete
                      </Button>
                    </View>
                  ) : (
                    <View className="w-full">
                      <Button
                        disabled={busy !== null || !supported}
                        onPress={() => {
                          download(selectedModel.id).catch(console.error);
                        }}
                      >
                        {busy === selectedModel.id
                          ? `Downloading ${percentDownloaded}%`
                          : `Download ${formatBytes(selectedModel.sizeBytes)}`}
                      </Button>
                      {busy === selectedModel.id ? (
                        <Pressable
                          accessibilityHint="Cancels the model download"
                          accessibilityLabel="Cancel"
                          accessibilityRole="button"
                          className="items-center py-sp-3"
                          hitSlop={8}
                          onPress={() => {
                            cancelDownload().catch(console.error);
                          }}
                          style={({ pressed }) =>
                            pressed ? { opacity: 0.6 } : null
                          }
                        >
                          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                            Cancel
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )
                ) : null}
              </DrawerFooter>
            </DrawerPagerPage>

            <DrawerPagerPage>
              <DrawerHeader className="flex-row items-center gap-sp-2">
                <Pressable
                  accessibilityLabel="Back"
                  className="h-9 w-9 items-center justify-center rounded-full"
                  onPress={() => setPage(0)}
                >
                  <ChevronLeft color={theme.text} size={22} />
                </Pressable>
                <DrawerTitle>Language</DrawerTitle>
              </DrawerHeader>
              <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
                {languageOptions.map((item) => {
                  const selected = language === item.id;
                  return (
                    <View
                      key={item.id}
                      className={cn(
                        "rounded-ui border",
                        selected
                          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
                          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
                      )}
                    >
                      <Pressable
                        accessibilityRole="button"
                        className="min-h-12 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
                        onPress={() => {
                          setLanguage(item.id);
                          if (selectedKey) {
                            saveVoiceLanguage(selectedKey, item.id)
                              .then(() => setPage(0))
                              .catch((error: unknown) =>
                                Alert.alert(
                                  "Voice settings",
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                ),
                              );
                          }
                        }}
                        style={({ pressed }) =>
                          pressed ? { opacity: 0.85 } : null
                        }
                      >
                        <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                          {item.label}
                        </Text>
                        {selected ? (
                          <Check color={theme.text} size={18} />
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })}
              </DrawerBody>
            </DrawerPagerPage>
          </DrawerPager>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function VoiceLinkRow({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress: () => void;
  value: string;
}) {
  const theme = useTheme();

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
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {value}
      </Text>
      <ChevronRight color={theme.textSecondary} size={18} />
    </Pressable>
  );
}

function DrawerLinkRow({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress: () => void;
  value: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-sp-3 overflow-hidden rounded-card border border-border px-sp-4 py-sp-3 dark:border-border-dark"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
    >
      <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {value}
      </Text>
      <ChevronRight color={theme.textSecondary} size={18} />
    </Pressable>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
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
