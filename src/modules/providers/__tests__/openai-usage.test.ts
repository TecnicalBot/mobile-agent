import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOpenAiOAuthFlavor } from "@/modules/providers/openai";
import { getValidOpenAiChatGptTokenInfo } from "@/modules/providers/openai-chatgpt-oauth";
import { getValidOpenAiTokenInfo } from "@/modules/providers/openai-oauth";
import {
  clearProviderUsageCache,
  formatUsagePlanLabel,
  formatUsageWindowLabel,
  getProviderUsage,
  normalizeUsageResponse,
  normalizeUsageWindow,
} from "@/modules/providers/openai-usage";

vi.mock("@/modules/providers/openai", () => ({
  getOpenAiOAuthFlavor: vi.fn(),
}));

vi.mock("@/modules/providers/openai-chatgpt-oauth", () => ({
  getValidOpenAiChatGptTokenInfo: vi.fn(),
  getValidOpenAiChatGptTokenInfoForAccount: vi.fn(),
}));

vi.mock("@/modules/providers/openai-oauth", () => ({
  getValidOpenAiTokenInfo: vi.fn(),
  getValidOpenAiTokenInfoForAccount: vi.fn(),
}));

const mockedFlavor = vi.mocked(getOpenAiOAuthFlavor);
const mockedChatGptToken = vi.mocked(getValidOpenAiChatGptTokenInfo);
const mockedCodexToken = vi.mocked(getValidOpenAiTokenInfo);

beforeEach(() => {
  clearProviderUsageCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  clearProviderUsageCache();
  vi.unstubAllGlobals();
});

describe("normalizeUsageWindow", () => {
  it("normalizes percent, window and reset time from the API", () => {
    expect(
      normalizeUsageWindow({
        used_percent: 37.5,
        limit_window_seconds: 18_000,
        reset_at: 1_700_000_000,
      }),
    ).toEqual({
      usedPercent: 37.5,
      leftPercent: 62.5,
      windowSeconds: 18_000,
      resetAt: 1_700_000_000_000,
    });
  });

  it("clamps out-of-range percentages", () => {
    expect(normalizeUsageWindow({ used_percent: 150 })).toMatchObject({
      usedPercent: 100,
      leftPercent: 0,
    });
  });

  it("derives reset time from reset_after_seconds", () => {
    const before = Date.now();
    const window = normalizeUsageWindow({
      used_percent: 10,
      reset_after_seconds: 3_600,
    });

    expect(window?.resetAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(window?.windowSeconds).toBeNull();
  });

  it("returns null when there is no usable window", () => {
    expect(normalizeUsageWindow(null)).toBeNull();
    expect(normalizeUsageWindow({})).toBeNull();
    expect(normalizeUsageWindow({ reset_at: 1 })).toBeNull();
  });
});

describe("normalizeUsageResponse", () => {
  it("reads plan, email, windows and credits", () => {
    const usage = normalizeUsageResponse({
      email: "user@example.com",
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 5, limit_window_seconds: 604_800 },
      },
      credits: { has_credits: true, unlimited: false },
    });

    expect(usage).toMatchObject({
      email: "user@example.com",
      plan: "plus",
      hasCredits: true,
      unlimited: false,
    });
    expect(usage.primary?.usedPercent).toBe(20);
    expect(usage.secondary?.usedPercent).toBe(5);
  });

  it("degrades to nulls for an empty payload", () => {
    expect(normalizeUsageResponse({})).toMatchObject({
      email: null,
      plan: null,
      primary: null,
      secondary: null,
      hasCredits: null,
      unlimited: null,
    });
  });
});

describe("formatUsageWindowLabel", () => {
  it("labels the known Codex windows", () => {
    expect(formatUsageWindowLabel(18_000)).toBe("5-hour limit");
    expect(formatUsageWindowLabel(604_800)).toBe("Weekly limit");
  });

  it("formats other windows by day/hour and falls back gracefully", () => {
    expect(formatUsageWindowLabel(86_400)).toBe("1-day limit");
    expect(formatUsageWindowLabel(7_200)).toBe("2-hour limit");
    expect(formatUsageWindowLabel(null)).toBe("Usage limit");
    expect(formatUsageWindowLabel(0)).toBe("Usage limit");
  });
});

describe("formatUsagePlanLabel", () => {
  it("maps known plan types to full plan names", () => {
    expect(formatUsagePlanLabel("plus")).toBe("ChatGPT Plus");
    expect(formatUsagePlanLabel("PLUS")).toBe("ChatGPT Plus");
    expect(formatUsagePlanLabel("pro")).toBe("ChatGPT Pro");
    expect(formatUsagePlanLabel("free")).toBe("ChatGPT Free");
    expect(formatUsagePlanLabel("team")).toBe("ChatGPT Team");
    expect(formatUsagePlanLabel("enterprise")).toBe("ChatGPT Enterprise");
  });

  it("title-cases unknown plan types and returns null for empty", () => {
    expect(formatUsagePlanLabel("pro_max")).toBe("ChatGPT Pro Max");
    expect(formatUsagePlanLabel(null)).toBeNull();
    expect(formatUsagePlanLabel("")).toBeNull();
    expect(formatUsagePlanLabel("   ")).toBeNull();
  });
});

describe("getProviderUsage", () => {
  it("fetches with the ChatGPT token and caches the result", async () => {
    mockedFlavor.mockReturnValue("chatgpt");
    mockedChatGptToken.mockResolvedValue({
      accessToken: "chatgpt-token",
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plan_type: "plus", rate_limit: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getProviderUsage("openai-chatgpt", null);
    const second = await getProviderUsage("openai-chatgpt", null);

    expect(first.plan).toBe("plus");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer chatgpt-token",
    );
    expect(
      (init.headers as Record<string, string>)["chatgpt-account-id"],
    ).toBeUndefined();
  });

  it("passes the Codex account id header for the legacy provider", async () => {
    mockedFlavor.mockReturnValue("codex");
    mockedCodexToken.mockResolvedValue({
      accessToken: "codex-token",
      accountId: "acct_123",
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getProviderUsage("openai", null);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>)["chatgpt-account-id"],
    ).toBe("acct_123");
  });

  it("throws when the usage request fails", async () => {
    mockedFlavor.mockReturnValue("chatgpt");
    mockedChatGptToken.mockResolvedValue({ accessToken: "tok" } as never);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    await expect(getProviderUsage("openai-chatgpt", null)).rejects.toThrow(
      "Usage request failed (HTTP 401).",
    );
  });
});
