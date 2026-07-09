import type {
  ProviderAuthType,
  ProviderConfig,
  ProviderFamily,
} from "@/types/app-state";

const LIVE_MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

type LiveModelCatalogResponse = {
  data?: Array<{
    context_window?: number;
    id?: string;
    max_tokens?: number;
    name?: string;
    object?: string;
    owned_by?: string;
    pricing?: {
      input?: string;
      output?: string;
    };
    tags?: string[];
    type?: string;
  }>;
  object?: string;
};

export type LiveCatalogModel = {
  contextWindow: number | null;
  id: string;
  inputPricePerToken: number | null;
  maxTokens: number | null;
  name: string;
  outputPricePerToken: number | null;
  ownedBy: string;
  tags: string[];
  type: string;
};

export type LiveProviderTemplate = {
  authType: ProviderAuthType;
  baseUrl: string | null;
  family: ProviderFamily;
  id: string;
  label: string;
  owner: string;
};

function parsePrice(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function formatLiveProviderOwnerLabel(owner: string) {
  return owner
    .split(/[-_./]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1),
    )
    .join(" ");
}

export function buildCatalogProviderId(owner: string) {
  return `catalog-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function getLiveProviderTemplate(owner: string): LiveProviderTemplate {
  const normalizedOwner = owner.trim().toLowerCase();

  if (normalizedOwner === "openai") {
    return {
      authType: "apiKey",
      baseUrl: "https://api.openai.com/v1",
      family: "openai",
      id: "openai-api",
      label: "OpenAI API",
      owner,
    };
  }

  if (normalizedOwner === "anthropic") {
    return {
      authType: "apiKey",
      baseUrl: "https://api.anthropic.com/v1",
      family: "anthropic",
      id: "anthropic",
      label: "Anthropic",
      owner,
    };
  }

  if (normalizedOwner === "google") {
    return {
      authType: "apiKey",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      family: "google",
      id: "google",
      label: "Google Gemini",
      owner,
    };
  }

  if (normalizedOwner === "openrouter") {
    return {
      authType: "apiKey",
      baseUrl: "https://openrouter.ai/api/v1",
      family: "openrouter",
      id: "openrouter",
      label: "OpenRouter",
      owner,
    };
  }

  return {
    authType: "apiKey",
    baseUrl: "",
    family: "openai-compatible",
    id: buildCatalogProviderId(owner),
    label: formatLiveProviderOwnerLabel(owner),
    owner,
  };
}

function getOwnerForProvider(provider: ProviderConfig) {
  if (provider.id === "openai" || provider.id === "openai-api") {
    return "openai";
  }

  if (provider.id === "anthropic") {
    return "anthropic";
  }

  if (provider.id === "google") {
    return "google";
  }

  if (provider.id === "openrouter") {
    return "openrouter";
  }

  if (provider.id.startsWith("catalog-")) {
    return provider.id.slice("catalog-".length);
  }

  return provider.id;
}

export async function fetchLiveModelCatalog(
  signal?: AbortSignal,
): Promise<LiveCatalogModel[]> {
  const response = await fetch(LIVE_MODEL_CATALOG_URL, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to load models (${response.status})`);
  }

  const payload = (await response.json()) as LiveModelCatalogResponse;

  return (payload.data ?? [])
    .filter((item) => typeof item.id === "string" && typeof item.owned_by === "string")
    .map((item) => ({
      contextWindow:
        typeof item.context_window === "number" ? item.context_window : null,
      id: item.id as string,
      inputPricePerToken: parsePrice(item.pricing?.input),
      maxTokens: typeof item.max_tokens === "number" ? item.max_tokens : null,
      name: item.name?.trim() || (item.id as string),
      outputPricePerToken: parsePrice(item.pricing?.output),
      ownedBy: item.owned_by as string,
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      type: item.type ?? "unknown",
    }));
}

export function getLiveModelsForProvider(
  models: LiveCatalogModel[],
  provider: ProviderConfig,
) {
  const languageModels = models.filter((model) => model.type === "language");

  if (provider.id === "openrouter") {
    return languageModels;
  }

  if (provider.id === "openai-compatible") {
    return [];
  }

  const acceptedOwners = [getOwnerForProvider(provider).toLowerCase()];

  return languageModels.filter((model) =>
    acceptedOwners.includes(model.ownedBy.toLowerCase()),
  );
}

export function getLiveProviderOwners(models: LiveCatalogModel[]) {
  return [
    ...new Set(
      models
        .filter((model) => model.type === "language")
        .map((model) => model.ownedBy),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
