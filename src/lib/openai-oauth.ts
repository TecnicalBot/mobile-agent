import { prepareOpenAICallbackSession } from "@/lib/local-server";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const BASE_URI = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const ACCESS_TOKEN_KEY = "openai_access_token";
const REFRESH_TOKEN_KEY = "openai_refresh_token";
const SESSION_KEY = "openai_oauth_session";
const REFRESH_SKEW_MS = 60_000;

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
};

export type OpenAiTokenInfo = {
  accessToken: string | null;
  accountId: string | null;
  email: string | null;
  expiresAt: number | null;
  refreshToken: string | null;
};

type OpenAiClaims = {
  chatgpt_account_id?: string;
  email?: string;
  exp?: number;
  organizations?: Array<{ id: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

let refreshPromise: Promise<OpenAiTokenInfo> | null = null;

async function returnToAppAfterOAuth() {
  try {
    await Linking.openURL(Linking.createURL("", { scheme: "mobile-agent" }));
  } catch {}
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  return atob(padded);
}

export function parseOpenAiJwtClaims(token: string): OpenAiClaims | undefined {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return undefined;
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1] ?? ""));
  } catch {
    return undefined;
  }
}

export function extractOpenAiAccountId(claims: OpenAiClaims | undefined) {
  if (!claims) {
    return null;
  }

  return (
    claims.chatgpt_account_id ??
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.organizations?.[0]?.id ??
    null
  );
}

function normalizeExpiresAt(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildTokenInfo(input: {
  accessToken: string;
  accountId?: string | null;
  email?: string | null;
  expiresAt?: number | null;
  expiresIn?: number | null;
  idToken?: string | null;
  refreshToken?: string | null;
}): OpenAiTokenInfo {
  const accessClaims = parseOpenAiJwtClaims(input.accessToken);
  const idClaims = input.idToken
    ? parseOpenAiJwtClaims(input.idToken)
    : undefined;
  const claims = idClaims ?? accessClaims;
  const expiresAtFromClaims =
    typeof accessClaims?.exp === "number" ? accessClaims.exp * 1000 : null;

  return {
    accessToken: input.accessToken,
    accountId: input.accountId ?? extractOpenAiAccountId(claims) ?? null,
    email: input.email ?? idClaims?.email ?? accessClaims?.email ?? null,
    expiresAt:
      normalizeExpiresAt(input.expiresAt) ??
      (typeof input.expiresIn === "number"
        ? Date.now() + input.expiresIn * 1000
        : expiresAtFromClaims),
    refreshToken: input.refreshToken ?? null,
  };
}

async function getLegacyTokenInfo(): Promise<OpenAiTokenInfo> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);

  if (!accessToken && !refreshToken) {
    return {
      accessToken: null,
      accountId: null,
      email: null,
      expiresAt: null,
      refreshToken: null,
    };
  }

  return {
    accessToken,
    accountId: accessToken
      ? extractOpenAiAccountId(parseOpenAiJwtClaims(accessToken))
      : null,
    email: accessToken
      ? (parseOpenAiJwtClaims(accessToken)?.email ?? null)
      : null,
    expiresAt:
      accessToken && parseOpenAiJwtClaims(accessToken)?.exp
        ? (parseOpenAiJwtClaims(accessToken)?.exp ?? 0) * 1000
        : null,
    refreshToken,
  };
}

async function persistTokenInfo(info: OpenAiTokenInfo) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(info));

  if (info.accessToken) {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, info.accessToken);
  } else {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  }

  if (info.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, info.refreshToken);
  } else {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }
}

export async function getOpenAiTokenInfo(): Promise<OpenAiTokenInfo> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as OpenAiTokenInfo;

      return {
        accessToken: parsed.accessToken ?? null,
        accountId: parsed.accountId ?? null,
        email: parsed.email ?? null,
        expiresAt: normalizeExpiresAt(parsed.expiresAt),
        refreshToken: parsed.refreshToken ?? null,
      };
    } catch {}
  }

  const legacy = await getLegacyTokenInfo();
  await persistTokenInfo(legacy);
  return legacy;
}

export async function handleLogin() {
  const randomBytes = Crypto.getRandomBytes(32);
  const codeVerifier = base64UrlEncode(randomBytes);
  const codeChallenge = await sha256(codeVerifier);
  const state = Math.random().toString(36).slice(2);

  let serverReadyPromise: Promise<unknown> | null = null;
  const callbackPromise = new Promise<void>((resolve, reject) => {
    serverReadyPromise = prepareOpenAICallbackSession(
      state,
      async (code, returnedState) => {
        if (returnedState !== state) {
          reject(new Error("OAuth state mismatch."));
          return;
        }

        try {
          const tokenData = await exchangeOpenAICodeForToken({
            code,
            codeVerifier,
          });

          await setOpenAiTokens({
            accessToken: tokenData.access_token,
            expiresIn: tokenData.expires_in ?? null,
            idToken: tokenData.id_token ?? null,
            refreshToken: tokenData.refresh_token ?? null,
          });

          await returnToAppAfterOAuth();
          resolve();
        } catch (e) {
          reject(e);
        }
      },
    );
  });

  await serverReadyPromise;

  const authUrl =
    "https://auth.openai.com/oauth/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: OPENAI_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: "openid profile email offline_access",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "mobile-agent",
    }).toString();

  const browserPromise = WebBrowser.openBrowserAsync(authUrl);
  browserPromise.catch(() => null);
  const browserClosedPromise = browserPromise.then((result) => {
    if (result.type === "opened") {
      return new Promise<never>(() => {});
    }

    throw new Error("ChatGPT OAuth was canceled before it completed.");
  });

  try {
    await Promise.race([
      callbackPromise,
      browserClosedPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Timed out waiting for the ChatGPT OAuth callback."));
        }, 120_000);
      }),
    ]);
  } finally {
    WebBrowser.dismissBrowser();
  }
}

export async function getOpenAiAccessToken() {
  return (await getOpenAiTokenInfo()).accessToken;
}

export async function getOpenAiRefreshToken() {
  return (await getOpenAiTokenInfo()).refreshToken;
}

export async function setOpenAiTokens(input: {
  accessToken: string;
  accountId?: string | null;
  email?: string | null;
  expiresAt?: number | null;
  expiresIn?: number | null;
  idToken?: string | null;
  refreshToken?: string | null;
}) {
  await persistTokenInfo(
    buildTokenInfo({
      accessToken: input.accessToken,
      accountId: input.accountId,
      email: input.email,
      expiresAt: input.expiresAt,
      expiresIn: input.expiresIn,
      idToken: input.idToken,
      refreshToken: input.refreshToken,
    }),
  );
}

export async function clearOpenAiTokens() {
  refreshPromise = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SESSION_KEY),
  ]);
}

function base64UrlEncode(buffer: Uint8Array) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(input: string) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );

  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function exchangeOpenAICodeForToken(params: {
  code: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CLIENT_ID,
    code: params.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(BASE_URI, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const text = await res.text();

  const data = JSON.parse(text) as unknown as
    | TokenResponse
    | Record<string, string>;

  if (!res.ok) {
    const errorData = data as Record<string, string>;
    throw new Error(
      errorData.error_description || errorData.error || "Token exchange failed",
    );
  }

  return data as TokenResponse;
}

export async function refreshOpenAIToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OPENAI_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(BASE_URI, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = (await res.json()) as unknown as
    | TokenResponse
    | Record<string, string>;

  if (!res.ok) {
    const errorData = data as Record<string, string>;
    throw new Error(
      errorData.error_description || errorData.error || "Token refresh failed",
    );
  }

  return data as TokenResponse;
}

export async function getValidOpenAiTokenInfo(): Promise<OpenAiTokenInfo> {
  const current = await getOpenAiTokenInfo();
  const now = Date.now();

  if (
    current.accessToken &&
    current.expiresAt !== null &&
    current.expiresAt - REFRESH_SKEW_MS > now
  ) {
    return current;
  }

  if (current.accessToken && current.expiresAt === null) {
    return current;
  }

  if (!current.refreshToken) {
    return current;
  }

  if (!refreshPromise) {
    refreshPromise = refreshOpenAIToken(current.refreshToken)
      .then(async (tokens) => {
        const next = buildTokenInfo({
          accessToken: tokens.access_token,
          accountId: current.accountId,
          email: current.email,
          expiresIn: tokens.expires_in ?? null,
          idToken: tokens.id_token ?? null,
          refreshToken: tokens.refresh_token ?? current.refreshToken,
        });

        await persistTokenInfo(next);
        return next;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}
