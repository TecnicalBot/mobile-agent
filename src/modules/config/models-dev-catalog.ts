import type { CuratedModelDefinition, ProviderConfig } from "@/core/types/app-state";
import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import { getSupportedProviderDefinition } from "@/modules/providers";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 5 * 60 * 1000;

export type ModelsDevModel = {
  cost?: {
    cache_read?: number;
    cache_write?: number;
    input?: number;
    output?: number;
  };
  id?: string;
  name?: string;
  status?: string;
  tool_call?: boolean;
  attachment?: boolean;
  reasoning?: boolean;
  limit?: {
    context?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
};

export type ModelsDevProvider = {
  api?: string;
  models?: Record<string, ModelsDevModel>;
};

let cachedCatalog: {
  expiresAt: number;
  providers: Record<string, ModelsDevProvider>;
} | null = null;

const PROVIDER_ID_ALIASES: Record<string, string> = {
  fireworks: "fireworks-ai",
  "openai-api": "openai",
};

// OpenCode Zen serves different model families over different protocols. The
// app only talks the OpenAI-compatible /chat/completions protocol, so only the
// models served over that endpoint are listed. GPT, Claude, Gemini, Grok and
// Qwen are served over /responses, /messages or the Google API instead.
const OPENCODE_CHAT_ONLY_FAMILIES = /^(?:claude|gemini|gpt-5|grok|qwen3)/i;

function normalizeBaseUrl(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function baseUrlsMatch(catalogApi: string, providerBaseUrl: string) {
  const a = normalizeBaseUrl(catalogApi);
  const b = normalizeBaseUrl(providerBaseUrl);

  if (a === b) {
    return true;
  }

  const aPathIndex = a.indexOf("/");
  const bPathIndex = b.indexOf("/");
  const aHost = aPathIndex === -1 ? a : a.slice(0, aPathIndex);
  const bHost = bPathIndex === -1 ? b : b.slice(0, bPathIndex);

  if (aHost !== bHost) {
    return false;
  }

  const aRest = aPathIndex === -1 ? "" : a.slice(aPathIndex);
  const bRest = bPathIndex === -1 ? "" : b.slice(bPathIndex);

  return aRest.startsWith(bRest) || bRest.startsWith(aRest);
}

function pathSegmentCount(url: string) {
  const path = normalizeBaseUrl(url).split("/").filter(Boolean);

  return path.length;
}

export function resolveModelsDevProviderKey(
  catalog: Record<string, ModelsDevProvider>,
  provider: ProviderConfig,
): string | null {
  if (getSupportedProviderDefinition(provider.id)) {
    return PROVIDER_ID_ALIASES[provider.id] ?? provider.id;
  }

  if (
    (provider.family !== "openai-compatible" && provider.family !== "xai") ||
    !provider.baseUrl
  ) {
    return null;
  }

  const baseUrl = provider.baseUrl;
  const candidates: [string, string][] = [];

  for (const [key, definition] of Object.entries(catalog)) {
    if (
      typeof definition?.api === "string" &&
      baseUrlsMatch(definition.api, baseUrl)
    ) {
      candidates.push([key, definition.api]);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const exact = candidates.find(
    ([, api]) => normalizeBaseUrl(api) === normalizeBaseUrl(baseUrl),
  );
  if (exact) {
    return exact[0];
  }

  candidates.sort(([, apiA], [, apiB]) => {
    const segmentsA = pathSegmentCount(apiA);
    const segmentsB = pathSegmentCount(apiB);

    return segmentsA - segmentsB;
  });

  return candidates[0][0];
}

export async function fetchModelsDevCatalogCached() {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.providers;
  }

  try {
    const response = await fetchWithTimeout(MODELS_DEV_URL, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`models.dev catalog request failed (${response.status}).`);
    }

    const providers = (await response.json()) as Record<
      string,
      ModelsDevProvider
    >;
    cachedCatalog = {
      expiresAt: Date.now() + CATALOG_TTL_MS,
      providers,
    };
    return providers;
  } catch (error) {
    if (cachedCatalog) return cachedCatalog.providers;
    throw error;
  }
}

export function invalidateModelsDevCatalog() {
  cachedCatalog = null;
}

export type ModelsDevModelInfo = {
  contextWindow: number | null;
  inputPricePerToken: number | null;
  outputPricePerToken: number | null;
};

function toPerTokenPrice(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value / 1_000_000
    : null;
}

function toModelInfo(model: ModelsDevModel): ModelsDevModelInfo {
  return {
    contextWindow: model.limit?.context ?? null,
    inputPricePerToken: toPerTokenPrice(model.cost?.input),
    outputPricePerToken: toPerTokenPrice(model.cost?.output),
  };
}

function findProviderModel(
  provider: ModelsDevProvider | undefined,
  match: (id: string, model: ModelsDevModel) => boolean,
) {
  for (const [key, model] of Object.entries(provider?.models ?? {})) {
    if (match(model.id?.trim() || key, model)) {
      return model;
    }
  }
  return null;
}

export function findModelsDevModel(
  catalog: Record<string, ModelsDevProvider>,
  providerId: string,
  modelId: string,
): ModelsDevModelInfo | null {
  const catalogId = PROVIDER_ID_ALIASES[providerId] ?? providerId;
  const direct = findProviderModel(
    catalog[catalogId],
    (id) => id === modelId,
  );
  if (direct) {
    return toModelInfo(direct);
  }

  const suffix = `/${modelId}`;
  let scopedMatch = findProviderModel(
    catalog[catalogId],
    (id) => id.endsWith(suffix),
  );
  if (scopedMatch) {
    return toModelInfo(scopedMatch);
  }

  for (const provider of Object.values(catalog)) {
    const exact = findProviderModel(provider, (id) => id === modelId);
    if (exact) {
      return toModelInfo(exact);
    }
  }

  for (const provider of Object.values(catalog)) {
    scopedMatch = findProviderModel(provider, (id) => id.endsWith(suffix));
    if (scopedMatch) {
      return toModelInfo(scopedMatch);
    }
  }

  return null;
}

export function getModelsDevDefinitionsForProvider(
  catalog: Record<string, ModelsDevProvider>,
  provider: ProviderConfig,
): CuratedModelDefinition[] {
  if (provider.family === "ollama" || provider.family === "on-device") {
    return [];
  }

  const catalogId = resolveModelsDevProviderKey(catalog, provider);
  if (!catalogId) {
    return [];
  }

  const models = catalog[catalogId]?.models ?? {};

  return Object.entries(models).flatMap(([key, model]) => {
    if (model.status === "deprecated") return [];

    const id = model.id?.trim() || key;
    if (catalogId === "opencode" && OPENCODE_CHAT_ONLY_FAMILIES.test(id)) {
      return [];
    }

    const inputModalities = model.modalities?.input ?? [];
    const outputModalities = model.modalities?.output ?? [];
    const imageGeneration = outputModalities.includes("image");

    return [
      {
        capabilities: {
          imageGeneration,
          imageInput:
            inputModalities.includes("image") || model.attachment === true,
          reasoning: model.reasoning === true ? true : undefined,
          tools: model.tool_call === true,
        },
        contextWindow: model.limit?.context ?? null,
        id,
        isFree:
          model.cost?.input === 0 && model.cost?.output === 0 ? true : undefined,
        kind: /(?:mini|nano|small|flash-lite)/i.test(id) ? "small" : "chat",
        label: model.name?.trim() || id,
        outputType: imageGeneration ? "image" : "text",
      },
    ];
  });
}
