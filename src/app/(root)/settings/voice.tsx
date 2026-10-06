import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";
import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";
import {
  WHISPER_MODELS,
  cancelVoiceDownload,
  deleteVoiceModel,
  downloadVoiceModel,
  isModelDownloaded,
  loadVoiceEngine,
  saveVoiceEngine,
  type VoiceEngine,
} from "@/modules/voice/models";

export default function VoiceSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [engine, setEngine] = useState<VoiceEngine>("system");
  const [installed, setInstalled] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const supported = Platform.OS === "android" || Platform.OS === "ios";

  const refresh = async () => {
    if (!supported) return;
    setEngine(await loadVoiceEngine());
    setInstalled(
      WHISPER_MODELS.filter((model) => isModelDownloaded(model.id)).map(
        (model) => model.id,
      ),
    );
  };
  useEffect(() => {
    refresh().catch((error: unknown) =>
      Alert.alert("Voice settings", String(error)),
    );
    // Downloads are scoped to this screen; leaving cancels unfinished files.
    return () => {
      cancelVoiceDownload().catch(console.error);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (next: VoiceEngine) => {
    try {
      saveVoiceEngine(next);
      setEngine(next);
    } catch (error) {
      Alert.alert(
        "Voice settings",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const download = async (id: "tiny" | "base") => {
    setBusy(id);
    setProgress(0);
    try {
      await downloadVoiceModel(id, setProgress);
      await refresh();
    } catch (error) {
      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusy(null);
    }
  };
  const remove = (id: "tiny" | "base") =>
    Alert.alert(
      "Delete voice model?",
      "The model can be downloaded again. If selected, voice input will switch to System.",
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

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          size="icon-xs"
          variant="ghost"
          onPress={() => router.back()}
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          Voice input
        </Text>
      </View>
      <Card className="gap-sp-3 p-sp-4">
        <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
          System (default)
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Uses your device’s speech recognizer. No model download; availability
          and network use depend on your device.
        </Text>
        <Button
          disabled={!supported || !!busy || engine === "system"}
          variant="secondary"
          onPress={() => select("system")}
        >
          {engine === "system" ? "Selected" : "Use System"}
        </Button>
      </Card>
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Local Whisper keeps audio on your phone. Download once, then use
        offline. Tap ✓ to transcribe and insert text. Voice messages are limited
        to 2 minutes. Keep this screen open while downloading.
      </Text>
      {!supported ? (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Local Whisper requires Android or iOS.
        </Text>
      ) : null}
      {WHISPER_MODELS.map((model) => (
        <Card key={model.id} className="gap-sp-3 p-sp-4">
          <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
            {model.label}
          </Text>
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {model.description}
          </Text>
          {busy === model.id ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                className="font-sans text-sm text-foreground dark:text-foreground-dark"
              >
                Downloading… {Math.round(progress * 100)}%
              </Text>
              <View className="h-1 overflow-hidden rounded-full bg-secondary dark:bg-secondary-dark">
                <View
                  style={{
                    width: `${progress * 100}%`,
                    height: 4,
                    backgroundColor: theme.text,
                  }}
                />
              </View>
              <Button
                variant="secondary"
                onPress={() => {
                  cancelVoiceDownload().catch(console.error);
                }}
              >
                Cancel download
              </Button>
            </>
          ) : installed.includes(model.id) ? (
            <View className="flex-row gap-sp-2">
              <Button
                className="flex-1"
                disabled={!!busy || engine === model.id}
                onPress={() => select(model.id)}
              >
                {engine === model.id ? "Selected" : "Use model"}
              </Button>
              <Button
                disabled={!!busy}
                variant="secondary"
                onPress={() => remove(model.id)}
              >
                Delete
              </Button>
            </View>
          ) : (
            <Button
              disabled={!supported || !!busy}
              variant="secondary"
              onPress={() => {
                download(model.id).catch(console.error);
              }}
            >
              Download
            </Button>
          )}
        </Card>
      ))}
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Models are downloaded from ggerganov/whisper.cpp on Hugging Face. Local
        inference needs a rebuilt app with Whisper support; speed and memory use
        depend on your phone.
      </Text>
    </Container>
  );
}
