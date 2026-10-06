import { Directory, File, Paths } from "expo-file-system";
import { createDownloadResumable } from "expo-file-system/legacy";
import { Platform } from "react-native";

export const WHISPER_MODELS = [
  {
    id: "tiny",
    label: "Whisper Tiny",
    bytes: 77691713,
    description: "Fastest • about 78 MB • multilingual",
  },
  {
    id: "base",
    label: "Whisper Base",
    bytes: 147951465,
    description: "Better accuracy • about 148 MB • multilingual",
  },
] as const;
export type VoiceEngine = "system" | (typeof WHISPER_MODELS)[number]["id"];

function directory() {
  const dir = new Directory(Paths.document, "mobile-agent", "voice");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function modelFile(id: Exclude<VoiceEngine, "system">) {
  return new File(directory(), `ggml-${id}.bin`);
}

export function isModelDownloaded(id: Exclude<VoiceEngine, "system">) {
  const file = modelFile(id);
  return (
    file.exists &&
    file.size === WHISPER_MODELS.find((model) => model.id === id)!.bytes
  );
}

export async function loadVoiceEngine(): Promise<VoiceEngine> {
  if (Platform.OS === "web") return "system";
  const file = new File(directory(), "settings.json");
  if (!file.exists) return "system";
  const parsed = JSON.parse(await file.text());
  return parsed.engine === "tiny" || parsed.engine === "base"
    ? parsed.engine
    : "system";
}

export function saveVoiceEngine(engine: VoiceEngine) {
  if (engine !== "system" && !isModelDownloaded(engine)) {
    throw new Error("Download this model before selecting it.");
  }
  new File(directory(), "settings.json").write(JSON.stringify({ engine }));
}

let download: ReturnType<typeof createDownloadResumable> | null = null;
let cancelled = false;

export async function downloadVoiceModel(
  id: Exclude<VoiceEngine, "system">,
  onProgress: (fraction: number) => void,
) {
  if (download) throw new Error("Another voice model is downloading.");
  const destination = modelFile(id);
  const partial = new File(directory(), `ggml-${id}.bin.part`);
  if (partial.exists) partial.delete();
  cancelled = false;
  download = createDownloadResumable(
    `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`,
    partial.uri,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress(
        Math.min(
          1,
          totalBytesWritten /
            (totalBytesExpectedToWrite > 0
              ? totalBytesExpectedToWrite
              : WHISPER_MODELS.find((model) => model.id === id)!.bytes),
        ),
      );
    },
  );
  try {
    const result = await download.downloadAsync();
    if (cancelled) return;
    if (
      !result ||
      result.status !== 200 ||
      partial.size !== WHISPER_MODELS.find((model) => model.id === id)!.bytes
    ) {
      throw new Error("Model download was incomplete. Please try again.");
    }
    if (destination.exists) destination.delete();
    partial.move(destination);
  } catch (error) {
    if (!cancelled) throw error;
  } finally {
    if (partial.exists && partial.uri !== destination.uri) partial.delete();
    download = null;
  }
}

export async function cancelVoiceDownload() {
  cancelled = true;
  await download?.cancelAsync();
}

export async function deleteVoiceModel(id: Exclude<VoiceEngine, "system">) {
  if ((await loadVoiceEngine()) === id) saveVoiceEngine("system");
  const file = modelFile(id);
  if (file.exists) file.delete();
}
