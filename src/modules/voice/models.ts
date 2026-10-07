import { Directory, File, Paths } from "expo-file-system";
import { createDownloadResumable } from "expo-file-system/legacy";
import { Platform } from "react-native";

import {
  fetchVoiceModelCatalogCached,
  findVoiceModel,
  getCachedVoiceModelCatalog,
  type VoiceCatalogModel,
} from "./catalog";

export type { VoiceCatalogModel, VoiceModelCatalogResult } from "./catalog";
export {
  fetchVoiceModelCatalogCached,
  getBundledVoiceModelCatalog,
  parseVoiceModelCatalog,
} from "./catalog";

/**
 * The list currently shown in Settings. It starts as the bundled catalog and is
 * replaced with the remote GitHub copy once `refreshVoiceModels` resolves, so
 * new or updated models reach the app without a rebuild.
 */
export let WHISPER_MODELS: VoiceCatalogModel[] = getCachedVoiceModelCatalog();

let catalogRefresh: Promise<VoiceCatalogModel[]> | null = null;

/** Fetch the latest voice model catalog from GitHub (falls back to bundled). */
export function refreshVoiceModels(): Promise<VoiceCatalogModel[]> {
  if (!catalogRefresh) {
    catalogRefresh = fetchVoiceModelCatalogCached()
      .then((models) => {
        WHISPER_MODELS = models;
        return models;
      })
      .finally(() => {
        catalogRefresh = null;
      });
  }
  return catalogRefresh;
}

/** A downloadable Whisper model id (everything except the System engine). */
export type WhisperModelId = string;
export type VoiceEngine = "system" | WhisperModelId;

/** BCP-47-ish codes accepted by whisper.cpp for the local models. */
export const WHISPER_LANGUAGES = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "nl", label: "Dutch" },
  { id: "ru", label: "Russian" },
  { id: "hi", label: "Hindi" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number]["id"];

export type WhisperLanguageOption = (typeof WHISPER_LANGUAGES)[number];

/** Languages offered for a model, honoring its catalog `supportedLanguages`. */
export function getModelLanguages(
  engine: VoiceEngine,
): WhisperLanguageOption[] {
  if (engine === "system") {
    return [...WHISPER_LANGUAGES];
  }
  const model = findVoiceModel(engine);
  const supported = model?.supportedLanguages;
  if (!supported) {
    return [...WHISPER_LANGUAGES];
  }
  const allowed = new Set(supported);
  return WHISPER_LANGUAGES.filter((item) => allowed.has(item.id));
}

type VoiceSettings = {
  engine: VoiceEngine;
  /** Selected spoken language per engine, so each model keeps its own choice. */
  languages: Record<string, WhisperLanguage>;
};

const DEFAULT_SETTINGS: VoiceSettings = { engine: "system", languages: {} };

function defaultLanguageFor(engine: VoiceEngine): WhisperLanguage {
  const options = getModelLanguages(engine);
  const english = options.find((item) => item.id === "en");
  return (english ?? options[0] ?? WHISPER_LANGUAGES[1]).id;
}

function directory() {
  const dir = new Directory(Paths.document, "mobile-agent", "voice");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function modelFile(id: WhisperModelId) {
  return new File(directory(), `ggml-${id}.bin`);
}

export function isModelDownloaded(id: WhisperModelId) {
  const model = findVoiceModel(id);
  if (!model) return false;
  const file = modelFile(id);
  return file.exists && file.size === model.sizeBytes;
}

async function loadSettings(): Promise<VoiceSettings> {
  if (Platform.OS === "web") return DEFAULT_SETTINGS;
  const file = new File(directory(), "settings.json");
  if (!file.exists) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(await file.text());
    // Preserve any non-empty engine string. Remote-only models are not in the
    // bundled catalog at cold start, and a removed model fails clearly at
    // runtime rather than silently resetting the user's choice.
    const engine =
      typeof parsed.engine === "string" &&
      parsed.engine &&
      parsed.engine !== "system"
        ? parsed.engine
        : "system";

    const languages: Record<string, WhisperLanguage> = {};
    if (parsed.languages && typeof parsed.languages === "object") {
      for (const [key, value] of Object.entries(parsed.languages)) {
        if (
          typeof value === "string" &&
          WHISPER_LANGUAGES.some((item) => item.id === value)
        ) {
          languages[key] = value as WhisperLanguage;
        }
      }
    }
    // Migrate the old single-language setting shape.
    if (
      Object.keys(languages).length === 0 &&
      typeof parsed.language === "string" &&
      parsed.language
    ) {
      languages[engine] = parsed.language;
    }
    return { engine, languages };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: VoiceSettings) {
  new File(directory(), "settings.json").write(JSON.stringify(settings));
}

export async function loadVoiceEngine(): Promise<VoiceEngine> {
  return (await loadSettings()).engine;
}

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  return loadSettings();
}

/** The spoken language currently selected for a given engine. */
export async function loadVoiceLanguage(
  engine: VoiceEngine,
): Promise<WhisperLanguage> {
  const settings = await loadSettings();
  const stored = settings.languages[engine];
  const options = getModelLanguages(engine);
  if (stored && options.some((item) => item.id === stored)) {
    return stored;
  }
  return defaultLanguageFor(engine);
}

/** The spoken language for whichever engine is currently active. */
export async function loadActiveVoiceLanguage(): Promise<WhisperLanguage> {
  const settings = await loadSettings();
  return loadVoiceLanguage(settings.engine);
}

function persist(settings: VoiceSettings) {
  if (settings.engine !== "system" && !isModelDownloaded(settings.engine)) {
    throw new Error("Download this model before selecting it.");
  }
  saveSettings(settings);
}

export async function saveVoiceEngine(engine: VoiceEngine) {
  const settings = await loadSettings();
  persist({ ...settings, engine });
}

export async function saveVoiceLanguage(
  engine: VoiceEngine,
  language: WhisperLanguage,
) {
  const settings = await loadSettings();
  const options = getModelLanguages(engine);
  const next = options.some((item) => item.id === language)
    ? language
    : defaultLanguageFor(engine);
  saveSettings({
    ...settings,
    languages: { ...settings.languages, [engine]: next },
  });
}

let download: ReturnType<typeof createDownloadResumable> | null = null;
let cancelled = false;

export async function downloadVoiceModel(
  id: WhisperModelId,
  onProgress: (fraction: number) => void,
) {
  if (download) throw new Error("Another voice model is downloading.");
  const model = findVoiceModel(id);
  if (!model) throw new Error("This voice model is not available.");
  const destination = modelFile(id);
  const expectedBytes = model.sizeBytes;
  if (destination.exists) destination.delete();
  cancelled = false;
  download = createDownloadResumable(
    model.url,
    destination.uri,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress(
        Math.min(
          1,
          totalBytesWritten /
            (totalBytesExpectedToWrite > 0
              ? totalBytesExpectedToWrite
              : expectedBytes),
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
      !destination.exists ||
      destination.size !== expectedBytes
    ) {
      throw new Error("Model download was incomplete. Please try again.");
    }
  } catch (error) {
    // Never leave a partial file behind; the size check treats it as missing.
    if (destination.exists) destination.delete();
    if (!cancelled) throw error;
  } finally {
    if (cancelled && destination.exists) destination.delete();
    download = null;
  }
}

export async function cancelVoiceDownload() {
  cancelled = true;
  await download?.cancelAsync();
}

export async function deleteVoiceModel(id: WhisperModelId) {
  if ((await loadVoiceEngine()) === id) await saveVoiceEngine("system");
  const file = modelFile(id);
  if (file.exists) file.delete();
}
