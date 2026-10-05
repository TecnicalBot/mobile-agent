import bundledCatalog from "../../../catalog/plugins.json";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";

export const PLUGIN_CATALOG_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/plugins.json";

const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CATALOG_PLUGINS = 100;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type PluginCatalogEntry = {
  author: string | null;
  description: string;
  id: string;
  label: string;
  url: string;
};

export type PluginCatalogResult = {
  entries: PluginCatalogEntry[];
  source: "bundled" | "github";
};

let cachedCatalog: {
  expiresAt: number;
  result: PluginCatalogResult;
} | null = null;

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
    throw new Error(`Plugin catalog field ${key} must be a non-empty string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`Plugin catalog field ${key} is too long.`);
  }

  return trimmed;
}

function getOptionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = record[key];

  if (value === undefined || value === null || value === "") return null;

  if (typeof value !== "string") {
    throw new Error(`Plugin catalog field ${key} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`Plugin catalog field ${key} is too long.`);
  }

  return trimmed || null;
}

function getHttpsUrl(value: string, label: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  return parsed.href;
}

function parseEntry(value: unknown): PluginCatalogEntry {
  const record = getRecord(value, "Plugin catalog entry");
  const id = getRequiredString(record, "id", 64);

  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`Invalid plugin catalog id: ${id}.`);
  }

  return {
    author: getOptionalString(record, "author", 120),
    description: getRequiredString(record, "description", 240),
    id,
    label: getRequiredString(record, "label", 80),
    url: getHttpsUrl(
      getRequiredString(record, "url", 2048),
      "Plugin catalog URL",
    ),
  };
}

export function parsePluginCatalog(value: unknown) {
  const catalog = getRecord(value, "Plugin catalog");

  if (catalog.version !== 1) {
    throw new Error("Unsupported plugin catalog version.");
  }

  if (!Array.isArray(catalog.plugins)) {
    throw new Error("Plugin catalog plugins must be an array.");
  }

  if (catalog.plugins.length > MAX_CATALOG_PLUGINS) {
    throw new Error("Plugin catalog contains too many plugins.");
  }

  const entries = catalog.plugins.map(parseEntry);
  const ids = new Set<string>();

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate plugin catalog id: ${entry.id}.`);
    }

    ids.add(entry.id);
  }

  return entries;
}

export async function fetchPluginCatalog(
  signal?: AbortSignal,
): Promise<PluginCatalogResult> {
  try {
    const response = await fetchWithTimeout(PLUGIN_CATALOG_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub catalog request failed (${response.status}).`);
    }

    return {
      entries: parsePluginCatalog(await response.json()),
      source: "github",
    };
  } catch (error) {
    if (signal?.aborted) throw error;

    return {
      entries: parsePluginCatalog(bundledCatalog),
      source: "bundled",
    };
  }
}

export async function fetchPluginCatalogCached(signal?: AbortSignal) {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.result;
  }

  const result = await fetchPluginCatalog(signal);
  cachedCatalog = {
    expiresAt: Date.now() + CATALOG_TTL_MS,
    result,
  };
  return result;
}
