import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forceRefreshOpenAiTokenInfoForAccount,
  getOpenAiTokenInfoForAccount,
  getValidOpenAiTokenInfoForAccount,
} from "@/modules/providers/openai-oauth";
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
}));

vi.mock("expo-linking", () => ({
  createURL: vi.fn(() => "mobile-agent://"),
  openURL: vi.fn(async () => {}),
}));

vi.mock("expo-web-browser", () => ({
  dismissBrowser: vi.fn(),
  openBrowserAsync: vi.fn(async () => ({ type: "opened" })),
}));

vi.mock("@/core/services/local-server", () => ({
  prepareOpenAICallbackSession: vi.fn(),
}));

function accountSessionKey(accountId: string) {
  return `openai_account_${accountId}_session`;
}

function setAccountSession(accountId: string) {
  store.set(
    accountSessionKey(accountId),
    JSON.stringify({
      accessToken: "expired-access",
      accountId,
      email: "user@example.com",
      expiresAt: Date.now() - 60_000,
      refreshToken: "refresh-1",
    }),
  );
}

describe("Codex OAuth token refresh", () => {
  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one refresh request between proactive and forced callers", async () => {
    setAccountSession("account-race");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh-access",
            expires_in: 3600,
            refresh_token: "refresh-2",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [proactive, forced] = await Promise.all([
      getValidOpenAiTokenInfoForAccount("account-race"),
      forceRefreshOpenAiTokenInfoForAccount("account-race"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proactive.accessToken).toBe("fresh-access");
    expect(forced.accessToken).toBe("fresh-access");

    const stored = await getOpenAiTokenInfoForAccount("account-race");
    expect(stored.accessToken).toBe("fresh-access");
    expect(stored.refreshToken).toBe("refresh-2");
  });

  it("clears the credential on invalid_grant instead of retrying forever", async () => {
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
      getValidOpenAiTokenInfoForAccount("account-revoked"),
    ).rejects.toBeInstanceOf(OAuthSessionExpiredError);

    expect(store.has(accountSessionKey("account-revoked"))).toBe(false);
  });
});
