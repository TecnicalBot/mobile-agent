import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import {
  prepareLocalCallbackSession,
  stopLocalCallbackServer,
  type LocalCallbackParams,
} from "@/core/services/local-server";
import { watchForOAuthCancel } from "@/modules/providers/oauth-browser-cancel";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1456;
const CALLBACK_PATH = "/auth/openrouter/callback";
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
const CALLBACK_TIMEOUT_MS = 180_000;

let loginInProgress = false;

function randomValue() {
  return btoa(String.fromCharCode(...Crypto.getRandomBytes(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function canceledError() {
  const error = new Error("OpenRouter sign-in was canceled.");
  error.name = "OAuthCanceledError";
  return error;
}

/** OpenRouter's PKCE flow issues an API key, not a refreshable OAuth session. */
export async function handleOpenRouterLogin(): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error(
      "OpenRouter browser sign-in is available on Android and iOS. On web, paste an API key instead.",
    );
  }
  if (loginInProgress) {
    throw new Error("An OpenRouter sign-in is already in progress.");
  }

  loginInProgress = true;
  try {
    const verifier = randomValue();
    const state = randomValue();
    const challenge = (
      await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        verifier,
        { encoding: Crypto.CryptoEncoding.BASE64 },
      )
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const params = new URLSearchParams({
      callback_url: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      key_label: "Mobile Agent",
      state,
    });

    const code = await waitForAuthorization(
      `https://openrouter.ai/auth?${params}`,
      state,
    );
    // Android opens the external browser; bring the user back after the callback.
    await Linking.openURL(
      Linking.createURL("", { scheme: "mobile-agent" }),
    ).catch(() => {});

    const response = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/auth/keys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          code_challenge_method: "S256",
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `OpenRouter sign-in failed (HTTP ${response.status}). Please try signing in again.`,
      );
    }

    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("key" in data) ||
      typeof data.key !== "string" ||
      !data.key.trim()
    ) {
      throw new Error(
        "OpenRouter did not return an API key. Please try signing in again.",
      );
    }
    return data.key.trim();
  } finally {
    loginInProgress = false;
  }
}

async function waitForAuthorization(url: string, state: string) {
  const { openBrowserAsync, dismissBrowser } = await import("expo-web-browser");
  let onCallback!: (params: LocalCallbackParams) => void;
  const callbackPromise = new Promise<string>((resolve, reject) => {
    onCallback = ({ code, query, state: returnedState }) => {
      try {
        // OpenRouter does not return state when authorization is denied.
        if (query.get("error") === "access_denied") throw canceledError();
        if (returnedState !== state)
          throw new Error("OpenRouter OAuth state mismatch.");
        if (query.get("error"))
          throw new Error("OpenRouter sign-in was not authorized.");
        if (!code?.trim())
          throw new Error("OpenRouter did not return an authorization code.");
        resolve(code);
      } catch (error) {
        reject(error);
        throw error;
      }
    };
  });
  callbackPromise.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelWatcher:
    Awaited<ReturnType<typeof watchForOAuthCancel>> | undefined;

  try {
    await prepareLocalCallbackSession({
      expectedState: state,
      host: CALLBACK_HOST,
      port: CALLBACK_PORT,
      path: CALLBACK_PATH,
      onCallback,
    });
    cancelWatcher = await watchForOAuthCancel(
      "OpenRouter sign-in was canceled.",
    );
    const browserClosedPromise = openBrowserAsync(url).then((result) => {
      if (result.type === "opened") return new Promise<never>(() => {});
      throw canceledError();
    });

    return await Promise.race([
      callbackPromise,
      browserClosedPromise,
      cancelWatcher.cancelPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for OpenRouter sign-in.")),
          CALLBACK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    cancelWatcher?.dispose();
    stopLocalCallbackServer();
    // dismissBrowser is iOS-only and can throw when no browser is open.
    try {
      await dismissBrowser();
    } catch {}
  }
}
