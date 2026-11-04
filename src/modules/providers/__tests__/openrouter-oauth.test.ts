import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalCallbackParams } from "@/core/services/local-server";
import { handleOpenRouterLogin } from "@/modules/providers/openrouter-oauth";

const mocks = vi.hoisted(() => ({
  browser: vi.fn(),
  dismiss: vi.fn(),
  dispose: vi.fn(),
  fetch: vi.fn(),
  openURL: vi.fn(),
  prepare: vi.fn(),
  stop: vi.fn(),
  watch: vi.fn(),
  platform: { OS: "android" },
}));

vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo-crypto", async () => {
  const { createHash, randomBytes } = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "sha256" },
    CryptoEncoding: { BASE64: "base64" },
    getRandomBytes: (size: number) => new Uint8Array(randomBytes(size)),
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("base64"),
  };
});
vi.mock("expo-linking", () => ({
  createURL: () => "mobile-agent://",
  openURL: mocks.openURL,
}));
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: mocks.browser,
  dismissBrowser: mocks.dismiss,
}));
vi.mock("@/core/services/local-server", () => ({
  prepareLocalCallbackSession: mocks.prepare,
  stopLocalCallbackServer: mocks.stop,
}));
vi.mock("@/core/fetch-with-timeout", () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock("@/modules/providers/oauth-browser-cancel", () => ({
  watchForOAuthCancel: mocks.watch,
}));

function callback(overrides: Record<string, string | null> = {}) {
  const authUrl = new URL(mocks.browser.mock.lastCall![0]);
  const values = {
    code: "authorization-code",
    state: authUrl.searchParams.get("state"),
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) query.set(key, value);
  }
  const input: LocalCallbackParams = {
    code: query.get("code"),
    state: query.get("state"),
    query,
  };
  // The HTTP callback server catches errors and renders a failure page.
  try {
    mocks.prepare.mock.lastCall![0].onCallback(input);
  } catch {}
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.OS = "android";
  mocks.prepare.mockResolvedValue({});
  mocks.dismiss.mockResolvedValue({ type: "dismiss" });
  mocks.openURL.mockResolvedValue(undefined);
  mocks.watch.mockResolvedValue({
    cancelPromise: new Promise<never>(() => {}),
    dispose: mocks.dispose,
  });
  mocks.fetch.mockResolvedValue(Response.json({ key: "sk-or-user-key" }));
  mocks.browser.mockImplementation(async () => {
    callback();
    return { type: "opened" };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenRouter browser sign-in", () => {
  it("uses S256 PKCE, validates state, and exchanges the code for an API key", async () => {
    await expect(handleOpenRouterLogin()).resolves.toBe("sk-or-user-key");

    const authUrl = new URL(mocks.browser.mock.calls[0][0]);
    expect(authUrl.origin + authUrl.pathname).toBe(
      "https://openrouter.ai/auth",
    );
    expect(authUrl.searchParams.get("callback_url")).toBe(
      "http://127.0.0.1:1456/auth/openrouter/callback",
    );
    expect(authUrl.searchParams.get("key_label")).toBe("Mobile Agent");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.prepare.mock.calls[0][0].expectedState).toBe(
      authUrl.searchParams.get("state"),
    );

    const [endpoint, request] = mocks.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(endpoint).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(request.method).toBe("POST");
    expect(body.code).toBe("authorization-code");
    expect(body.code_challenge_method).toBe("S256");
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      createHash("sha256").update(body.code_verifier).digest("base64url"),
    ).toBe(authUrl.searchParams.get("code_challenge"));
    expect(authUrl.searchParams.has("code_verifier")).toBe(false);
    expect(mocks.openURL).toHaveBeenCalledWith("mobile-agent://");
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });

  it.each(["wrong-state", null])(
    "rejects mismatched or missing callback state (%s)",
    async (state) => {
      mocks.browser.mockImplementation(async () => {
        callback({ state });
        return { type: "opened" };
      });
      await expect(handleOpenRouterLogin()).rejects.toThrow("state mismatch");
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.stop).toHaveBeenCalledOnce();
    },
  );

  it("rejects a callback without a code", async () => {
    mocks.browser.mockImplementation(async () => {
      callback({ code: null });
      return { type: "opened" };
    });
    await expect(handleOpenRouterLogin()).rejects.toThrow("authorization code");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("treats denied authorization without state as cancellation", async () => {
    mocks.browser.mockImplementation(async () => {
      callback({ error: "access_denied", code: null, state: null });
      return { type: "opened" };
    });
    await expect(handleOpenRouterLogin()).rejects.toMatchObject({
      name: "OAuthCanceledError",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("handles browser dismissal and allows another sign-in afterward", async () => {
    mocks.browser.mockResolvedValueOnce({ type: "cancel" });
    await expect(handleOpenRouterLogin()).rejects.toMatchObject({
      name: "OAuthCanceledError",
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
    await expect(handleOpenRouterLogin()).resolves.toBe("sk-or-user-key");
  });

  it("handles Android lifecycle cancellation", async () => {
    mocks.browser.mockResolvedValue({ type: "opened" });
    const error = new Error("Canceled");
    error.name = "OAuthCanceledError";
    mocks.watch.mockResolvedValue({
      cancelPromise: Promise.reject(error),
      dispose: mocks.dispose,
    });
    await expect(handleOpenRouterLogin()).rejects.toBe(error);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("cleans up after timeout", async () => {
    vi.useFakeTimers();
    mocks.browser.mockResolvedValue({ type: "opened" });
    const result = expect(handleOpenRouterLogin()).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(180_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("surfaces callback-server failures without opening the browser", async () => {
    mocks.prepare.mockRejectedValue(new Error("Port unavailable"));
    await expect(handleOpenRouterLogin()).rejects.toThrow("Port unavailable");
    expect(mocks.browser).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("surfaces browser launch failures", async () => {
    mocks.browser.mockRejectedValue(new Error("Browser unavailable"));
    await expect(handleOpenRouterLogin()).rejects.toThrow(
      "Browser unavailable",
    );
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not expose the provider response body when key exchange fails", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("sensitive response", { status: 403 }),
    );
    await expect(handleOpenRouterLogin()).rejects.toThrow(
      "OpenRouter sign-in failed (HTTP 403)",
    );
  });

  it.each([{}, { key: "" }, { key: "  " }, { key: 123 }, null])(
    "rejects invalid key responses: %j",
    async (data) => {
      mocks.fetch.mockResolvedValue(Response.json(data));
      await expect(handleOpenRouterLogin()).rejects.toThrow(
        "did not return an API key",
      );
    },
  );

  it("rejects concurrent sign-in attempts", async () => {
    mocks.browser.mockResolvedValue({ type: "cancel" });
    const first = handleOpenRouterLogin();
    await expect(handleOpenRouterLogin()).rejects.toThrow(
      "already in progress",
    );
    await expect(first).rejects.toMatchObject({ name: "OAuthCanceledError" });
  });

  it("keeps manual key entry as the web fallback", async () => {
    mocks.platform.OS = "web";
    await expect(handleOpenRouterLogin()).rejects.toThrow("paste an API key");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
