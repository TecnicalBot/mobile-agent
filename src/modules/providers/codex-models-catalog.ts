import bundledCatalog from "../../../catalog/openai-codex-models.json";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import type { CuratedModelDefinition } from "@/core/types/app-state";

/**
 * The set of models the Codex backend accepts, plus the built-in fallbacks shown
 * for the Codex OAuth provider. It lives in the GitHub catalog so the allow/deny
 * rules can be adjusted without shipping a new app build — the Codex backend
 * rejects models we list too optimistically (for example `gpt-5.6-pro`).
 */
export const CODEX_MODEL_CATALOG_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/openai-codex-models.json";

const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_MODELS = 50;
const MAX_DENY_ENTRIES = 100;
const MAX_DENY_PATTERNS = 25;
const MAX_PATTERN_LENGTH = 64;
const MAX_LABEL_LENGTH = 80;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const CAPABILITY_KEYS = [
  "imageGeneration",
  "imageInput",
  "reasoning",
  "tools",
] as const;

export type CodexModelCatalog = {
  denyPatterns: RegExp[];
  denySet: Set<string>;
  minMajor: number;
  minMinor: number;
  models: CuratedModelDefinition[];
};

function getRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function getStringArray(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  if (value.length > maximum) {
    throw new Error(`${label} has too many entries.`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`${label} contains a non-string entry.`);
    }

    return entry;
  });
}

function parseModelDefinition(value: unknown): CuratedModelDefinition {
  const record = getRecord(value, "Codex catalog model");
  const id = record.id;

  if (typeof id !== "string" || !MODEL_ID_PATTERN.test(id)) {
    throw new Error("Codex catalog model id is invalid.");
  }

  const kind = record.kind;

  if (kind !== "chat" && kind !== "small") {
    throw new Error(`Codex catalog model ${id} has an invalid kind.`);
  }

  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : id;

  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error(`Codex catalog model ${id} label is too long.`);
  }

  const definition: CuratedModelDefinition = { id, kind, label };

  if (record.capabilities !== undefined) {
    const capabilities = getRecord(
      record.capabilities,
      `Codex catalog model ${id} capabilities`,
    );

    for (const [key, capability] of Object.entries(capabilities)) {
      if (
        !CAPABILITY_KEYS.includes(key as (typeof CAPABILITY_KEYS)[number]) ||
        typeof capability !== "boolean"
      ) {
        throw new Error(
          `Codex catalog model ${id} has an invalid capability "${key}".`,
        );
      }
    }

    definition.capabilities =
      capabilities as CuratedModelDefinition["capabilities"];
  }

  if (record.contextWindow !== undefined) {
    const contextWindow = record.contextWindow;

    if (
      typeof contextWindow !== "number" ||
      !Number.isSafeInteger(contextWindow) ||
      contextWindow <= 0 ||
      contextWindow > 1_000_000
    ) {
      throw new Error(`Codex catalog model ${id} has an invalid contextWindow.`);
    }

    definition.contextWindow = contextWindow;
  }

  return definition;
}

export function parseCodexModelCatalog(value: unknown): CodexModelCatalog {
  const record = getRecord(value, "Codex model catalog");

  if (record.version !== 1) {
    throw new Error("Codex model catalog requires version 1.");
  }

  if (!Array.isArray(record.models) || record.models.length > MAX_MODELS) {
    throw new Error("Codex model catalog must list at most 50 models.");
  }

  const models = record.models.map(parseModelDefinition);
  const deny = getStringArray(record.deny ?? [], "deny", MAX_DENY_ENTRIES);
  if (deny.some((id) => !MODEL_ID_PATTERN.test(id))) {
    throw new Error("deny contains an invalid model id.");
  }
  const denyPatterns = getStringArray(
    record.denyPatterns ?? [],
    "denyPatterns",
    MAX_DENY_PATTERNS,
  ).map((pattern) => {
    if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error("Codex catalog deny pattern has an invalid length.");
    }

    try {
      return new RegExp(pattern);
    } catch {
      throw new Error(`Codex catalog deny pattern is not a valid regex.`);
    }
  });

  const minVersion =
    typeof record.minVersion === "string" ? record.minVersion : "5.5";
  const minMatch = VERSION_PATTERN.exec(minVersion);

  if (!minMatch) {
    throw new Error("Codex catalog minVersion is invalid.");
  }

  return {
    models,
    denySet: new Set(deny),
    denyPatterns,
    minMajor: Number(minMatch[1]),
    minMinor: Number(minMatch[2] ?? 0),
  };
}

const bundled = parseCodexModelCatalog(bundledCatalog);
let activeCatalog: CodexModelCatalog = bundled;
let cached: { catalog: CodexModelCatalog; expiresAt: number } | null = null;

export function getActiveCodexModelCatalog() {
  return activeCatalog;
}

export function getCodexBuiltInModels() {
  return activeCatalog.models;
}

export function isModelAllowedByCodexCatalog(
  catalog: CodexModelCatalog,
  modelId: string,
): boolean {
  if (catalog.denySet.has(modelId)) {
    return false;
  }

  if (catalog.denyPatterns.some((pattern) => pattern.test(modelId))) {
    return false;
  }

  if (catalog.models.some((model) => model.id === modelId)) {
    return true;
  }

  const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(modelId);

  if (!match) {
    return false;
  }

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);

  return (
    major > catalog.minMajor ||
    (major === catalog.minMajor && minor >= catalog.minMinor)
  );
}

export function isCodexOAuthModel(modelId: string) {
  return isModelAllowedByCodexCatalog(activeCatalog, modelId);
}

export async function fetchCodexModelCatalog(
  signal?: AbortSignal,
): Promise<CodexModelCatalog> {
  const response = await fetchWithTimeout(CODEX_MODEL_CATALOG_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `GitHub Codex model catalog request failed (${response.status}).`,
    );
  }

  return parseCodexModelCatalog(await response.json());
}

export async function fetchCodexModelCatalogCached(
  signal?: AbortSignal,
): Promise<CodexModelCatalog> {
  if (cached && cached.expiresAt > Date.now()) {
    activeCatalog = cached.catalog;
    return cached.catalog;
  }

  try {
    const catalog = await fetchCodexModelCatalog(signal);
    activeCatalog = catalog;
    cached = { catalog, expiresAt: Date.now() + CATALOG_TTL_MS };
    return catalog;
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    // Keep the last good catalog (bundled on a cold cache) and retry after the
    // TTL, so a transient outage never widens or breaks the Codex model list.
    cached = { catalog: activeCatalog, expiresAt: Date.now() + CATALOG_TTL_MS };
    return activeCatalog;
  }
}
