import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLegacyOpenAiChatGptTokens,
  forceRefreshOpenAiChatGptTokenForAccount,
  getOpenAiChatGptTokenInfo,
  getOpenAiChatGptTokenInfoForAccount,
  getValidOpenAiChatGptTokenInfoForAccount,
  migrateLegacyOpenAiChatGptTokensToAccount,
} from "@/modules/providers/openai-chatgpt-oauth";
import { isOAuthCanceledError } from "@/modules/providers/oauth-browser-cancel";
import { OAuthSessionExpiredError } from "@/modules/providers/oauth-errors";

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

function setAccountSession(
  accountId: string,
  overrides: Record<string, unknown> = {},
) {
  store.set(
    accountSessionKey(accountId),
    JSON.stringify({
      accessToken: "expired-access",
      clientId: "dynamic_agent_client",
      email: "user@example.com",
      expiresAt: Date.now() - 60_000,
      idToken: "id-token",
      refreshToken: "refresh-1",
      scopes: ["openid"],
      ...overrides,
    }),
  );
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "fresh-access",
    expires_in: 3600,
    refresh_token: "refresh-2",
    ...overrides,
  };
}

describe("ChatGPT plan token refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one refresh request between proactive and forced callers", async () => {
    setAccountSession("account-race");
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(JSON.stringify(tokenResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [proactive, forced] = await Promise.all([
      getValidOpenAiChatGptTokenInfoForAccount("account-race"),
      forceRefreshOpenAiChatGptTokenForAccount("account-race"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proactive.accessToken).toBe("fresh-access");
    expect(forced.accessToken).toBe("fresh-access");

    const stored = await getOpenAiChatGptTokenInfoForAccount("account-race");
    expect(stored.accessToken).toBe("fresh-access");
    expect(stored.refreshToken).toBe("refresh-2");
  });

  it("clears the credential and throws a session-expired error on invalid_grant", async () => {
    setAccountSession("account-revoked");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          }),
      ),
    );

    await expect(
      getValidOpenAiChatGptTokenInfoForAccount("account-revoked"),
    ).rejects.toBeInstanceOf(OAuthSessionExpiredError);

    expect(store.has(accountSessionKey("account-revoked"))).toBe(false);
    const stored = await getOpenAiChatGptTokenInfoForAccount("account-revoked");
    expect(stored.refreshToken).toBeNull();
  });

  it("keeps a newer rotated credential when the failed refresh is stale", async () => {
    setAccountSession("account-rotated");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Another request rotated the token while this refresh was in flight.
        setAccountSession("account-rotated", {
          accessToken: "newer-access",
          expiresAt: Date.now() + 3_600_000,
          refreshToken: "refresh-2",
        });

        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        });
      }),
    );

    const info = await getValidOpenAiChatGptTokenInfoForAccount(
      "account-rotated",
    );

    expect(info.accessToken).toBe("newer-access");
    expect(info.refreshToken).toBe("refresh-2");
    const stored = await getOpenAiChatGptTokenInfoForAccount("account-rotated");
    expect(stored.refreshToken).toBe("refresh-2");
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
