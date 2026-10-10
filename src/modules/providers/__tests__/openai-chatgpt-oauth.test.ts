import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLegacyOpenAiChatGptTokens,
  getOpenAiChatGptTokenInfo,
  getOpenAiChatGptTokenInfoForAccount,
  migrateLegacyOpenAiChatGptTokensToAccount,
} from "@/modules/providers/openai-chatgpt-oauth";
import { isOAuthCanceledError } from "@/modules/providers/oauth-browser-cancel";

const { store } = vi.hoisted(() => ({
  store: new Map<string, string>(),
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64" },
  digestStringAsync: vi.fn(async () => "digest"),
  getRandomBytes: vi.fn((size: number) => new Uint8Array(size)),
  randomUUID: vi.fn(() => "uuid"),
}));

vi.mock("expo-linking", () => ({
  createURL: vi.fn(() => "mobile-agent://"),
  openURL: vi.fn(async () => {}),
}));

vi.mock("expo-web-browser", () => ({
  dismissBrowser: vi.fn(),
  openBrowserAsync: vi.fn(async () => ({ type: "opened" })),
}));

vi.mock("@/core/services/crypto", () => ({
  initializeCrypto: vi.fn(),
}));

vi.mock("@/core/services/local-server", () => ({
  prepareLocalCallbackSession: vi.fn(),
}));

const LEGACY_SESSION_KEY = "openai_chatgpt_session";

function accountSessionKey(accountId: string) {
  return `openai_chatgpt_account_${accountId}_session`;
}

const legacySession = JSON.stringify({
  accessToken: "legacy-access",
  clientId: "dynamic_agent_client",
  email: "user@example.com",
  expiresAt: 123,
  idToken: "legacy-id",
  refreshToken: "legacy-refresh",
  scopes: ["openid"],
});

beforeEach(() => {
  store.clear();
});

describe("migrateLegacyOpenAiChatGptTokensToAccount", () => {
  it("copies a legacy session into the account and clears the legacy slot", async () => {
    store.set(LEGACY_SESSION_KEY, legacySession);

    await migrateLegacyOpenAiChatGptTokensToAccount("account-1");

    const accountInfo =
      await getOpenAiChatGptTokenInfoForAccount("account-1");
    expect(accountInfo.accessToken).toBe("legacy-access");
    expect(accountInfo.refreshToken).toBe("legacy-refresh");
    expect(accountInfo.email).toBe("user@example.com");

    const legacyInfo = await getOpenAiChatGptTokenInfo();
    expect(legacyInfo.accessToken).toBeNull();
    expect(legacyInfo.refreshToken).toBeNull();
    expect(store.has(LEGACY_SESSION_KEY)).toBe(false);
  });

  it("leaves the account empty and clears the legacy slot when nothing to migrate", async () => {
    await migrateLegacyOpenAiChatGptTokensToAccount("account-2");

    const accountInfo =
      await getOpenAiChatGptTokenInfoForAccount("account-2");
    expect(accountInfo.accessToken).toBeNull();
    expect(store.has(accountSessionKey("account-2"))).toBe(false);
    expect(store.has(LEGACY_SESSION_KEY)).toBe(false);
  });
});

describe("clearLegacyOpenAiChatGptTokens", () => {
  it("removes the legacy session slot", async () => {
    store.set(LEGACY_SESSION_KEY, legacySession);

    await clearLegacyOpenAiChatGptTokens();

    expect(store.has(LEGACY_SESSION_KEY)).toBe(false);
  });
});

describe("isOAuthCanceledError", () => {
  it("returns true only for errors named OAuthCanceledError", () => {
    const canceled = new Error("Sign-in was canceled before it completed.");
    canceled.name = "OAuthCanceledError";
    expect(isOAuthCanceledError(canceled)).toBe(true);

    expect(isOAuthCanceledError(new Error("boom"))).toBe(false);
    expect(isOAuthCanceledError("canceled")).toBe(false);
    expect(isOAuthCanceledError(null)).toBe(false);
    expect(isOAuthCanceledError(undefined)).toBe(false);
  });
});
