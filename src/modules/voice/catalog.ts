import bundledCatalog from "../../../catalog/voice-models.json";
import { fetchWithTimeout } from "@/core/fetch-with-timeout";

export const VOICE_MODEL_CATALOG_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/voice-models.json";

const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CATALOG_MODELS = 20;
const MAX_MODEL_BYTES = 4_000_000_000;
const MAX_LANGUAGES = 100;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A single downloadable Whisper model offered by the voice catalog. */
export type VoiceCatalogModel = {
  id: string;
  label: string;
  description: string;
  url: string;
  sizeBytes: number;
  /**
   * Optional list of language ids this model supports. When omitted, every
   * language in the app's list is offered (multilingual models).
   */
  supportedLanguages?: string[];
};

export type VoiceModelCatalogResult = {
  models: VoiceCatalogModel[];
  source: "bundled" | "github";
};

let cachedCatalog: { expiresAt: number; models: VoiceCatalogModel[] } | null =
  null;

function getRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function getRequiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Voice catalog field ${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`Voice catalog field ${key} is too long.`);
  }
  return trimmed;
}

function getPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  maximum: number,
) {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new Error(
      `Voice catalog field ${key} must be a positive integer up to ${maximum}.`,
    );
  }
  return value;
}

function getHttpsUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Voice model url must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Voice model url must use HTTPS.");
  }
  return parsed.href;
}

function getOptionalStringArray(
  record: Record<string, unknown>,
  key: string,
  maximum: number,
) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximum ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(
      `Voice catalog field ${key} must be a non-empty array of strings.`,
    );
  }
  return value.map((item) => (item as string).trim());
}

function parseModel(value: unknown): VoiceCatalogModel {
  const record = getRecord(value, "Voice catalog model");
  const id = getRequiredString(record, "id", 64);
  if (!MODEL_ID_PATTERN.test(id)) {
    throw new Error(`Invalid voice catalog model id: ${id}.`);
  }

  return {
    id,
    label: getRequiredString(record, "label", 100),
    description: getRequiredString(record, "description", 200),
    url: getHttpsUrl(getRequiredString(record, "url", 2048)),
    sizeBytes: getPositiveInteger(record, "sizeBytes", MAX_MODEL_BYTES),
    supportedLanguages: getOptionalStringArray(
      record,
      "supportedLanguages",
      MAX_LANGUAGES,
    ),
  };
}

export function parseVoiceModelCatalog(value: unknown): VoiceCatalogModel[] {
  const catalog = getRecord(value, "Voice model catalog");
  if (catalog.version !== 1) {
    throw new Error("Unsupported voice model catalog version.");
  }
  if (!Array.isArray(catalog.models)) {
    throw new Error("Voice catalog models must be an array.");
  }
  if (catalog.models.length > MAX_CATALOG_MODELS) {
    throw new Error("Voice catalog contains too many models.");
  }

  const models = catalog.models.map(parseModel);
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new Error(`Duplicate voice catalog id: ${model.id}.`);
    }
    ids.add(model.id);
  }
  return models;
}

export function getBundledVoiceModelCatalog(): VoiceCatalogModel[] {
  return parseVoiceModelCatalog(bundledCatalog);
}

/**
 * Synchronous view of the best-known catalog: the last successfully fetched
 * GitHub copy if present, otherwise the bundled copy. Used for exact download
 * size validation without awaiting the network.
 */
export function getCachedVoiceModelCatalog(): VoiceCatalogModel[] {
  return cachedCatalog?.models ?? getBundledVoiceModelCatalog();
}

export function findVoiceModel(id: string): VoiceCatalogModel | null {
  return getCachedVoiceModelCatalog().find((model) => model.id === id) ?? null;
}

async function fetchVoiceModelCatalog(): Promise<VoiceModelCatalogResult> {
  try {
    const response = await fetchWithTimeout(VOICE_MODEL_CATALOG_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) {
      throw new Error(`Voice catalog request failed (${response.status}).`);
    }
    return {
      models: parseVoiceModelCatalog(await response.json()),
      source: "github",
    };
  } catch {
    return { models: getBundledVoiceModelCatalog(), source: "bundled" };
  }
}

/**
 * Returns the voice model catalog, preferring a fresh GitHub copy and falling
 * back to the bundled one. Cached in memory so settings screens are cheap to
 * reopen; a newly merged catalog entry appears after the cache expires or the
 * app restarts, with no rebuild required.
 */
export async function fetchVoiceModelCatalogCached(): Promise<
  VoiceCatalogModel[]
> {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.models;
  }
  const result = await fetchVoiceModelCatalog();
  cachedCatalog = {
    expiresAt: Date.now() + CATALOG_TTL_MS,
    models: result.models,
  };
  return result.models;
}
