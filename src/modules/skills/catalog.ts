import bundledCatalog from "../../../catalog/skills.json";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";

export const SKILL_CATALOG_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/skills.json";

const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CATALOG_SKILLS = 100;
const MAX_EXTRA_FILES = 20;
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type SkillCatalogEntry = {
  author: string | null;
  description: string;
  extraFiles: string[];
  id: string;
  label: string;
  url: string;
};

export type SkillCatalogResult = {
  entries: SkillCatalogEntry[];
  source: "bundled" | "github";
};

let cachedCatalog: {
  expiresAt: number;
  result: SkillCatalogResult;
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
    throw new Error(`Skill catalog field ${key} must be a non-empty string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`Skill catalog field ${key} is too long.`);
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
    throw new Error(`Skill catalog field ${key} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`Skill catalog field ${key} is too long.`);
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

function getExtraFiles(record: Record<string, unknown>) {
  const value = record.extraFiles;

  if (value === undefined || value === null) return [];

  if (!Array.isArray(value) || value.length > MAX_EXTRA_FILES) {
    throw new Error("Skill catalog extraFiles must be an array.");
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Skill catalog extraFiles[${index}] must be a string.`);
    }

    return getHttpsUrl(item.trim(), `Skill catalog extraFiles[${index}]`);
  });
}

function parseEntry(value: unknown): SkillCatalogEntry {
  const record = getRecord(value, "Skill catalog entry");
  const id = getRequiredString(record, "id", 64);

  if (!SKILL_ID_PATTERN.test(id)) {
    throw new Error(`Invalid skill catalog id: ${id}.`);
  }

  return {
    author: getOptionalString(record, "author", 120),
    description: getRequiredString(record, "description", 240),
    extraFiles: getExtraFiles(record),
    id,
    label: getRequiredString(record, "label", 80),
    url: getHttpsUrl(
      getRequiredString(record, "url", 2048),
      "Skill catalog URL",
    ),
  };
}

export function parseSkillCatalog(value: unknown) {
  const catalog = getRecord(value, "Skill catalog");

  if (catalog.version !== 1) {
    throw new Error("Unsupported skill catalog version.");
  }

  if (!Array.isArray(catalog.skills)) {
    throw new Error("Skill catalog skills must be an array.");
  }

  if (catalog.skills.length > MAX_CATALOG_SKILLS) {
    throw new Error("Skill catalog contains too many skills.");
  }

  const entries = catalog.skills.map(parseEntry);
  const ids = new Set<string>();

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate skill catalog id: ${entry.id}.`);
    }

    ids.add(entry.id);
  }

  return entries;
}

export async function fetchSkillCatalog(
  signal?: AbortSignal,
): Promise<SkillCatalogResult> {
  try {
    const response = await fetchWithTimeout(SKILL_CATALOG_URL, {
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
      entries: parseSkillCatalog(await response.json()),
      source: "github",
    };
  } catch (error) {
    if (signal?.aborted) throw error;

    return {
      entries: parseSkillCatalog(bundledCatalog),
      source: "bundled",
    };
  }
}

export async function fetchSkillCatalogCached(signal?: AbortSignal) {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.result;
  }

  const result = await fetchSkillCatalog(signal);
  cachedCatalog = {
    expiresAt: Date.now() + CATALOG_TTL_MS,
    result,
  };
  return result;
}
