import { getOpenAiOAuthFlavor } from "@/modules/providers/openai";
import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import {
  getValidOpenAiTokenInfo,
  getValidOpenAiTokenInfoForAccount,
} from "@/modules/providers/openai-oauth";

/**
 * Codex sign-in can read allowance from this private backend endpoint.
 * ChatGPT token-sharing credentials cannot: direct those users to settings.
 * https://developers.openai.com/siwc/ui-ux-guidelines#link-to-chatgpt-usage
 */
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CHATGPT_USAGE_SETTINGS_URL = "https://chatgpt.com/settings/usage";
const CACHE_TTL_MS = 60_000;

export type UsageWindow = {
  leftPercent: number;
  resetAt: number | null;
  usedPercent: number;
  windowSeconds: number | null;
};

export type ProviderUsage = {
  email: string | null;
  fetchedAt: number;
  hasCredits: boolean | null;
  plan: string | null;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  unlimited: boolean | null;
};

type ApiWindow = {
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
  used_percent?: number;
};

type ApiRateLimit = {
  primary_window?: ApiWindow | null;
  secondary_window?: ApiWindow | null;
};

type ApiUsageResponse = {
  credits?: {
    balance?: string | number;
    has_credits?: boolean;
    unlimited?: boolean;
  } | null;
  email?: string;
  plan_type?: string;
  rate_limit?: ApiRateLimit | null;
};

const memoryCache = new Map<
  string,
  { fetchedAt: number; usage: ProviderUsage }
>();
const inflight = new Map<string, Promise<ProviderUsage>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeResetAtMs(value: number | undefined) {
  if (value === undefined) {
    return null;
  }

  // The API reports Unix seconds; tolerate millisecond values too.
  return value > 10_000_000_000 ? Math.round(value) : Math.round(value * 1000);
}

export function normalizeUsageWindow(
  window: unknown,
): UsageWindow | null {
  if (!isRecord(window)) {
    return null;
  }

  const usedPercent = numberValue(window.used_percent);

  if (usedPercent === undefined) {
    return null;
  }

  const clampedUsed = Math.max(0, Math.min(100, usedPercent));
  const resetAt = normalizeResetAtMs(numberValue(window.reset_at));
  const windowSeconds = numberValue(window.limit_window_seconds) ?? null;

  return {
    usedPercent: clampedUsed,
    leftPercent: Math.max(0, Math.min(100, 100 - clampedUsed)),
    resetAt:
      resetAt ??
      (() => {
        const resetAfter = numberValue(window.reset_after_seconds);

        return resetAfter === undefined
          ? null
          : Date.now() + resetAfter * 1000;
      })(),
    windowSeconds,
  };
}

export function normalizeUsageResponse(api: unknown): ProviderUsage {
  const record = isRecord(api) ? (api as ApiUsageResponse) : {};
  const rateLimit = isRecord(record.rate_limit)
    ? (record.rate_limit as ApiRateLimit)
    : null;
  const credits = isRecord(record.credits) ? record.credits : null;

  return {
    email: typeof record.email === "string" ? record.email : null,
    fetchedAt: Date.now(),
    hasCredits:
      typeof credits?.has_credits === "boolean"
        ? credits.has_credits
        : null,
    plan: typeof record.plan_type === "string" ? record.plan_type : null,
    primary: normalizeUsageWindow(rateLimit?.primary_window),
    secondary: normalizeUsageWindow(rateLimit?.secondary_window),
    unlimited:
      typeof credits?.unlimited === "boolean" ? credits.unlimited : null,
  };
}

export function formatUsageWindowLabel(windowSeconds: number | null) {
  if (!windowSeconds || windowSeconds <= 0) {
    return "Usage limit";
  }

  if (Math.abs(windowSeconds - 18_000) < 120) {
    return "5-hour limit";
  }

  if (Math.abs(windowSeconds - 604_800) < 120) {
    return "Weekly limit";
  }

  if (windowSeconds % 86_400 === 0) {
    return `${windowSeconds / 86_400}-day limit`;
  }

  if (windowSeconds % 3_600 === 0) {
    return `${windowSeconds / 3_600}-hour limit`;
  }

  return "Usage limit";
}

/**
 * Maps the backend `plan_type` value to the full human-friendly plan name so
 * the UI reads "ChatGPT Plus" instead of the raw "plus" token.
 */
export function formatUsagePlanLabel(plan: string | null) {
  if (!plan || !plan.trim()) {
    return null;
  }

  switch (plan.trim().toLowerCase()) {
    case "free":
      return "ChatGPT Free";
    case "plus":
      return "ChatGPT Plus";
    case "pro":
      return "ChatGPT Pro";
    case "team":
      return "ChatGPT Team";
    case "enterprise":
      return "ChatGPT Enterprise";
    default:
      return `ChatGPT ${plan
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")}`;
  }
}

export async function fetchOpenAiUsage(input: {
  accountId?: string | null;
  signal?: AbortSignal;
  token: string;
}): Promise<ProviderUsage> {
  const response = await fetchWithTimeout(USAGE_URL, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.token}`,
      ...(input.accountId
        ? { "chatgpt-account-id": input.accountId }
        : {}),
    },
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`Usage request failed (HTTP ${response.status}).`);
  }

  return normalizeUsageResponse(await response.json());
}

function cacheKey(providerId: string, accountId: string | null) {
  return `${providerId}:${accountId ?? "default"}`;
}

export function clearProviderUsageCache(providerId?: string) {
  if (!providerId) {
    memoryCache.clear();
    inflight.clear();
    return;
  }

  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(`${providerId}:`)) {
      memoryCache.delete(key);
    }
  }

  for (const key of [...inflight.keys()]) {
    if (key.startsWith(`${providerId}:`)) {
      inflight.delete(key);
    }
  }
}

/**
 * Resolves the provider's account token, fetches plan usage and memoizes it
 * briefly so re-selecting the provider does not refetch on every render.
 */
export async function getProviderUsage(
  providerId: string,
  accountId: string | null,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<ProviderUsage> {
  const flavor = getOpenAiOAuthFlavor(providerId);
  if (!flavor) {
    throw new Error("Plan usage is only available for OpenAI subscription providers.");
  }
  if (flavor === "chatgpt") {
    throw new Error("ChatGPT plan limits are not exposed to this sign-in. View usage in ChatGPT settings.");
  }
  const key = cacheKey(providerId, accountId);
  const cached = memoryCache.get(key);

  if (
    !options.force &&
    cached &&
    Date.now() - cached.fetchedAt < CACHE_TTL_MS
  ) {
    return cached.usage;
  }

  const pending = inflight.get(key);

  if (pending && !options.force) {
    return pending;
  }

  const request = (async () => {
    const info = accountId
      ? await getValidOpenAiTokenInfoForAccount(accountId)
      : await getValidOpenAiTokenInfo();

    if (!info.accessToken) {
      throw new Error("ChatGPT session is not connected.");
    }

    return fetchOpenAiUsage({
      accountId: info.accountId,
      signal: options.signal,
      token: info.accessToken,
    });
  })();

  inflight.set(key, request);

  try {
    const usage = await request;
    memoryCache.set(key, { fetchedAt: Date.now(), usage });
    return usage;
  } finally {
    inflight.delete(key);
  }
}
