import type { ModelRegistryEntry } from "expo-ai-kit";

import bundledCatalog from "../../../catalog/on-device-models.json";

import type { CuratedModelDefinition } from "@/types/app-state";

export const ON_DEVICE_MODEL_CATALOG_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/on-device-models.json";

const CATALOG_TTL_MS = 5 * 60 * 1000;
const MAX_CATALOG_MODELS = 50;
const MAX_MODEL_BYTES = 20_000_000_000;
const MAX_RAM_BYTES = 32_000_000_000;
const MAX_CONTEXT_WINDOW = 1_000_000;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type OnDeviceCatalogModel = ModelRegistryEntry & {
  capabilities: {
    reasoning: boolean;
    tools: boolean;
  };
};

export type OnDeviceModelCatalogResult = {
  models: OnDeviceCatalogModel[];
  source: "bundled" | "github";
};

let cachedCatalog: {
  expiresAt: number;
  models: OnDeviceCatalogModel[];
} | null = null;
let registeredCatalogIds = new Set<string>();

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
    throw new Error(
      `On-device catalog field ${key} must be a non-empty string.`,
    );
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`On-device catalog field ${key} is too long.`);
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
      `On-device catalog field ${key} must be a positive integer up to ${maximum}.`,
    );
  }
  return value;
}

function getBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
) {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`On-device catalog field ${key} must be a boolean.`);
  }
  return value;
}

function getHttpsUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("On-device model downloadUrl must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("On-device model downloadUrl must use HTTPS.");
  }
  return parsed.href;
}

function getSupportedPlatforms(record: Record<string, unknown>) {
  const value = record.supportedPlatforms;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((platform) => platform === "ios" || platform === "android")
  ) {
    throw new Error(
      "On-device catalog supportedPlatforms must contain ios and/or android.",
    );
  }
  return [...new Set(value)] as ("ios" | "android")[];
}

function parseModel(value: unknown): OnDeviceCatalogModel {
  const record = getRecord(value, "On-device catalog model");
  const id = getRequiredString(record, "id", 64);
  if (!MODEL_ID_PATTERN.test(id)) {
    throw new Error(`Invalid on-device catalog model id: ${id}.`);
  }

  const sha256 = getRequiredString(record, "sha256", 64);
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(
      `On-device catalog model ${id} has an invalid SHA256 hash.`,
    );
  }

  const capabilities =
    record.capabilities === undefined
      ? {}
      : getRecord(
          record.capabilities,
          `On-device catalog model ${id} capabilities`,
        );

  return {
    id,
    name: getRequiredString(record, "name", 100),
    parameterCount: getRequiredString(record, "parameterCount", 32),
    quantization: getRequiredString(record, "quantization", 64),
    downloadUrl: getHttpsUrl(getRequiredString(record, "downloadUrl", 2048)),
    sha256: sha256.toLowerCase(),
    sizeBytes: getPositiveInteger(record, "sizeBytes", MAX_MODEL_BYTES),
    contextWindow: getPositiveInteger(
      record,
      "contextWindow",
      MAX_CONTEXT_WINDOW,
    ),
    minRamBytes: getPositiveInteger(record, "minRamBytes", MAX_RAM_BYTES),
    supportedPlatforms: getSupportedPlatforms(record),
    license: getRequiredString(record, "license", 80),
    capabilities: {
      tools: getBoolean(capabilities, "tools", true),
      reasoning: getBoolean(capabilities, "reasoning", false),
    },
  };
}

export function parseOnDeviceModelCatalog(value: unknown) {
  const catalog = getRecord(value, "On-device model catalog");
  if (catalog.version !== 1) {
    throw new Error("Unsupported on-device model catalog version.");
  }
  if (!Array.isArray(catalog.models)) {
    throw new Error("On-device catalog models must be an array.");
  }
  if (catalog.models.length > MAX_CATALOG_MODELS) {
    throw new Error("On-device catalog contains too many models.");
  }

  const models = catalog.models.map(parseModel);
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new Error(`Duplicate on-device catalog id: ${model.id}.`);
    }
    ids.add(model.id);
  }
  return models;
}

function toRegistryEntry(model: OnDeviceCatalogModel): ModelRegistryEntry {
  const { capabilities: _capabilities, ...entry } = model;
  return entry;
}

export async function registerOnDeviceCatalogModels(
  models: OnDeviceCatalogModel[],
) {
  const { Platform } = await import("react-native");
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return models;
  }

  const { getRegistryEntry, registerModel, unregisterModel } =
    await import("expo-ai-kit");
  const nextIds = new Set(models.map((model) => model.id));
  for (const modelId of registeredCatalogIds) {
    if (!nextIds.has(modelId)) {
      unregisterModel(modelId);
    }
  }

  for (const model of models) {
    const wasCustomModel = unregisterModel(model.id);
    if (wasCustomModel || !getRegistryEntry(model.id)) {
      registerModel(toRegistryEntry(model));
    }
  }
  registeredCatalogIds = nextIds;
  return models;
}

export function getOnDeviceModelDefinitions(
  models: OnDeviceCatalogModel[],
): CuratedModelDefinition[] {
  return models.map((model) => ({
    id: model.id,
    kind: "chat",
    label: model.name,
    transport: "onDevice",
    capabilities: {
      tools: model.capabilities.tools,
      imageInput: false,
      imageGeneration: false,
      reasoning: model.capabilities.reasoning,
    },
    options: {
      onDevice: {
        backend: "auto",
        contextWindow: model.contextWindow,
        downloadBytes: model.sizeBytes,
        minRamBytes: model.minRamBytes,
      },
    },
  }));
}

async function loadBundledCatalog() {
  return await registerOnDeviceCatalogModels(
    parseOnDeviceModelCatalog(bundledCatalog),
  );
}

export async function fetchOnDeviceModelCatalog(
  signal?: AbortSignal,
): Promise<OnDeviceModelCatalogResult> {
  try {
    const response = await fetch(ON_DEVICE_MODEL_CATALOG_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `GitHub on-device catalog request failed (${response.status}).`,
      );
    }
    return {
      models: await registerOnDeviceCatalogModels(
        parseOnDeviceModelCatalog(await response.json()),
      ),
      source: "github",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      models: await loadBundledCatalog(),
      source: "bundled",
    };
  }
}

export async function fetchOnDeviceModelCatalogCached() {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    await registerOnDeviceCatalogModels(cachedCatalog.models);
    return cachedCatalog.models;
  }

  const result = await fetchOnDeviceModelCatalog();
  cachedCatalog = {
    expiresAt: Date.now() + CATALOG_TTL_MS,
    models: result.models,
  };
  return result.models;
}

export function getBundledOnDeviceModelCatalog() {
  return parseOnDeviceModelCatalog(bundledCatalog);
}
