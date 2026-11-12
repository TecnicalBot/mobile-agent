import * as SecureStore from "expo-secure-store";

import type { CuratedModelDefinition } from "@/core/types/app-state";

/**
 * ChatGPT-plan token sharing serves inference from the public Responses API.
 * Its model list is account-scoped, so we discover it from `GET /v1/models`
 * and fall back to a bundled allowlist when discovery fails.
 */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type ChatGptRemoteModel = {
  context_window?: number;
  display_name?: string;
  input_modalities?: string[];
  slug: string;
  supported_in_api?: boolean;
  supported_reasoning_levels?: { effort?: string }[];
  visibility?: string;
};

/**
 * Allowlist mirrored from the official client. Used when the account's model
 * list cannot be fetched so the provider still offers usable models.
 */
export const CHATGPT_FALLBACK_MODEL_SLUGS = [
  "gpt-6.1-sol",
  "gpt-6.1-sol-fast",
  "gpt-6-sol",
  "gpt-6-sol-fast",
  "gpt-6-luna",
  "gpt-6-luna-fast",
  "gpt-6-astra",
  "gpt-6-astra-fast",
  "gpt-5.6-sol",
  "gpt-5.6-sol-fast",
  "gpt-5.6-luna",
  "gpt-5.6-luna-fast",
  "gpt-5.6-terra",
  "gpt-5.6-terra-fast",
  "gpt-5.5",
  "gpt-5.5-fast",
] as const;

type CacheEntry = {
  fetchedAt: number;
  models: ChatGptRemoteModel[];
};

function getCacheKey(accountId: string | null) {
  return `openai_chatgpt_models_${accountId ?? "legacy"}`;
}

function getLegacyCacheKey(clientId: string) {
  return `openai_chatgpt_models_${clientId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Turns a model slug such as `gpt-5.6-luna-fast` into `GPT-5.6 Luna Fast`.
 */
export function formatChatGptModelLabel(slug: string) {
  const parts = slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => {
      if (/^gpt$/i.test(part)) {
        return "GPT";
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    });

  return parts.reduce((label, part, index) => {
    if (index === 0) {
      return part;
    }

    const previous = parts[index - 1];
    const separator = previous === "GPT" && /^\d/.test(part) ? "-" : " ";

    return `${label}${separator}${part}`;
  }, "");
}

export function isChatGptRemoteModel(
  model: ChatGptRemoteModel,
): boolean {
  return model.visibility === "list" && model.supported_in_api === true;
}

export function filterChatGptRemoteModels(
  models: ChatGptRemoteModel[],
): ChatGptRemoteModel[] {
  return models.filter(isChatGptRemoteModel);
}

export function mapChatGptRemoteModel(
  model: ChatGptRemoteModel,
): CuratedModelDefinition {
  const modalities = model.input_modalities ?? [];
  const label = model.display_name?.trim();

  return {
    id: model.slug,
    kind: "chat",
    label: label && label.length > 0 ? label : formatChatGptModelLabel(model.slug),
    contextWindow:
      typeof model.context_window === "number" ? model.context_window : null,
    capabilities: {
      tools: true,
      imageInput: modalities.includes("image"),
      audioInput: modalities.includes("audio"),
      videoInput: modalities.includes("video"),
      imageGeneration: false,
      reasoning: (model.supported_reasoning_levels?.length ?? 0) > 0,
    },
    transport: "openaiResponses",
  };
}

export function getFallbackChatGptModels(): CuratedModelDefinition[] {
  return CHATGPT_FALLBACK_MODEL_SLUGS.map((slug) => ({
    id: slug,
    kind: "chat" as const,
    label: formatChatGptModelLabel(slug),
    capabilities: { tools: true },
    transport: "openaiResponses" as const,
  }));
}

function parseCache(raw: string | null): CacheEntry | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
      return null;
    }

    const models = parsed.models.filter(
      (model): model is ChatGptRemoteModel =>
        isRecord(model) && typeof model.slug === "string",
    );

    if (models.length === 0) {
      return null;
    }

    return {
      fetchedAt:
        typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
      models,
    };
  } catch {
    return null;
  }
}

export async function readChatGptModelCache(
  accountId: string | null,
): Promise<CacheEntry | null> {
  return parseCache(await SecureStore.getItemAsync(getCacheKey(accountId)));
}

async function writeChatGptModelCache(
  accountId: string | null,
  models: ChatGptRemoteModel[],
) {
  await SecureStore.setItemAsync(
    getCacheKey(accountId),
    JSON.stringify({ fetchedAt: Date.now(), models } satisfies CacheEntry),
  );
}

/**
 * Drops the cached model list for an account. Called on sign-in, disconnect,
 * and account switch so one account's (or plan's) list is never reused for
 * another. `clientId` is accepted to clean up the pre-account cache key.
 */
export async function clearChatGptModelCache(
  accountId: string | null,
  clientId?: string | null,
) {
  await SecureStore.deleteItemAsync(getCacheKey(accountId));

  if (clientId) {
    await SecureStore.deleteItemAsync(getLegacyCacheKey(clientId));
  }
}

/**
 * Fetches and filters the account's ChatGPT model list.
 */
export async function fetchChatGptRemoteModels(input: {
  baseURL?: string | null;
  signal?: AbortSignal;
  token: string;
}): Promise<ChatGptRemoteModel[]> {
  const base = (input.baseURL?.replace(/\/+$/, "") || DEFAULT_BASE_URL);
  const response = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${input.token}` },
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`ChatGPT model discovery failed (HTTP ${response.status}).`);
  }

  const data = (await response.json().catch(() => null)) as unknown;

  return filterChatGptRemoteModels(parseRemoteModels(data));
}

/**
 * The plan model endpoint has historically used a `{ models: [...] }` envelope
 * with ChatGPT-specific fields. A standard OpenAI `{ data: [...] }` list is
 * accepted too, since it is account-scoped and already filtered by the server.
 */
function parseRemoteModels(data: unknown): ChatGptRemoteModel[] {
  if (!isRecord(data)) {
    return [];
  }

  if (Array.isArray(data.models)) {
    return data.models.filter(
      (model): model is ChatGptRemoteModel =>
        isRecord(model) && typeof model.slug === "string",
    );
  }

  if (Array.isArray(data.data)) {
    return data.data.flatMap((model): ChatGptRemoteModel[] => {
      if (!isRecord(model)) {
        return [];
      }

      const slug =
        typeof model.id === "string"
          ? model.id
          : typeof model.slug === "string"
            ? model.slug
            : null;

      if (!slug || !/^(gpt-|o\d|chatgpt)/i.test(slug)) {
        return [];
      }

      return [
        {
          ...model,
          slug,
          supported_in_api: true,
          visibility: "list",
        },
      ];
    });
  }

  return [];
}

/**
 * Returns the account's models, preferring a fresh cache. Falls back to a
 * stale cache and finally to the bundled allowlist so the provider always
 * exposes something usable.
 */
export async function discoverChatGptModels(input: {
  accountId: string | null;
  baseURL?: string | null;
  clientId: string | null;
  token: string;
}): Promise<CuratedModelDefinition[]> {
  const cached = await readChatGptModelCache(input.accountId);

  if (
    cached &&
    cached.fetchedAt > 0 &&
    Date.now() - cached.fetchedAt < CACHE_TTL_MS
  ) {
    return cached.models.map(mapChatGptRemoteModel);
  }

  try {
    const remote = await fetchChatGptRemoteModels({
      baseURL: input.baseURL,
      token: input.token,
    });

    if (remote.length === 0) {
      throw new Error("No ChatGPT models are available for this account.");
    }

    await writeChatGptModelCache(input.accountId, remote);

    return remote.map(mapChatGptRemoteModel);
  } catch (error) {
    if (cached) {
      return cached.models.map(mapChatGptRemoteModel);
    }

    throw error;
  }
}
