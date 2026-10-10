import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

import { prepareLocalCallbackSession } from "@/core/services/local-server";
import { initializeCrypto } from "@/core/services/crypto";
import { watchForOAuthCancel } from "@/modules/providers/oauth-browser-cancel";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const RESOURCE = "https://api.openai.com/v1";
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const AGENT_NAME = "Mobile Agent";
const TOKEN_SHARING_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  TOKEN_SHARING_SCOPE,
].join(" ");

/**
 * Error codes returned by token sharing that indicate the account/plan cannot
 * use this route. Retrying these never helps, so callers must surface them.
 */
export const NON_RETRYABLE_CHATGPT_SHARING_CODES = [
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
] as const;
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

const HOST_ID_KEY = "openai_chatgpt_agent_host_id";
const LEGACY_SESSION_KEY = "openai_chatgpt_session";
const REFRESH_SKEW_MS = 60_000;

function getAccountSessionKey(accountId: string) {
  return `openai_chatgpt_account_${accountId}_session`;
}

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
};

export type OpenAiChatGptTokenInfo = {
  accessToken: string | null;
  clientId: string | null;
  email: string | null;
  expiresAt: number | null;
  idToken: string | null;
  refreshToken: string | null;
  scopes: string[];
};

const EMPTY_TOKEN_INFO: OpenAiChatGptTokenInfo = {
  accessToken: null,
  clientId: null,
  email: null,
  expiresAt: null,
  idToken: null,
  refreshToken: null,
  scopes: [],
};

let refreshPromiseForAccount = new Map<string, Promise<OpenAiChatGptTokenInfo>>();
let legacyRefreshPromise: Promise<OpenAiChatGptTokenInfo> | null = null;

async function returnToAppAfterOAuth() {
  try {
    await Linking.openURL(Linking.createURL("", { scheme: "mobile-agent" }));
  } catch {}
}

function normalizeExpiresAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTokenInfo(raw: string | null): OpenAiChatGptTokenInfo | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OpenAiChatGptTokenInfo>;

    return {
      accessToken: parsed.accessToken ?? null,
      clientId: parsed.clientId ?? null,
      email: parsed.email ?? null,
      expiresAt: normalizeExpiresAt(parsed.expiresAt),
      idToken: parsed.idToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
    };
  } catch {
    return null;
  }
}

async function getAgentHostId() {
  const existing = await SecureStore.getItemAsync(HOST_ID_KEY);

  if (existing) {
    return existing;
  }

  const hostId = `urn:uuid:${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(HOST_ID_KEY, hostId);
  return hostId;
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

async function generatePkce() {
  const verifier = base64UrlEncode(Crypto.getRandomBytes(48));
  const challenge = await sha256(verifier);
  return { challenge, verifier };
}

function randomValue() {
  return base64UrlEncode(Crypto.getRandomBytes(32));
}

function buildAuthorizeUrl(input: {
  hostId: string;
  nonce: string;
  pkceChallenge: string;
  savedClientId: string | null;
  state: string;
}) {
  const params: Record<string, string> = {
    client_id: input.savedClientId ?? REGISTRATION_CLIENT_ID,
    ext_agent_host_id: input.hostId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    resource: RESOURCE,
    state: input.state,
    nonce: input.nonce,
    code_challenge_method: "S256",
    code_challenge: input.pkceChallenge,
  };

  if (!input.savedClientId) {
    params.agent_name_hint = AGENT_NAME;
  }

  return `${AUTHORIZE_URL}?${new URLSearchParams(params).toString()}`;
}

async function exchangeCodeForToken(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as
    | TokenResponse
    | Record<string, string>;

  if (!res.ok) {
    const errorData = data as Record<string, string>;
    throw new Error(
      errorData.error_description ||
        errorData.error ||
        `ChatGPT token exchange failed (HTTP ${res.status}).`,
    );
  }

  return data as TokenResponse;
}

async function verifyIdToken(idToken: string, clientId: string, nonce: string) {
  await initializeCrypto();

  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(
    idToken,
    createRemoteJWKSet(new URL(JWKS_URL)),
    {
      algorithms: ["RS256"],
      audience: clientId,
      issuer: ISSUER,
      requiredClaims: ["exp", "nonce", "sub"],
    },
  );

  if (typeof payload.sub !== "string" || !payload.sub.trim()) {
    throw new Error("ChatGPT sign-in returned an ID token without a subject.");
  }

  if (payload.nonce !== nonce) {
    throw new Error("ChatGPT sign-in returned an ID token with a mismatched nonce.");
  }

  return payload;
}

function buildTokenInfo(input: {
  clientId: string;
  email: string | null;
  expiresIn?: number | null;
  idToken?: string | null;
  refreshToken?: string | null;
  scopes: string[];
  tokens: TokenResponse;
}): OpenAiChatGptTokenInfo {
  return {
    accessToken: input.tokens.access_token,
    clientId: input.clientId,
    email: input.email,
    expiresAt:
      typeof input.expiresIn === "number"
        ? Date.now() + input.expiresIn * 1000
        : typeof input.tokens.expires_in === "number"
          ? Date.now() + input.tokens.expires_in * 1000
          : null,
    idToken: input.tokens.id_token ?? input.idToken ?? null,
    refreshToken: input.tokens.refresh_token ?? input.refreshToken ?? null,
    scopes: input.scopes,
  };
}

async function persistTokenInfo(info: OpenAiChatGptTokenInfo) {
  await SecureStore.setItemAsync(LEGACY_SESSION_KEY, JSON.stringify(info));
}

async function persistTokenInfoForAccount(
  accountId: string,
  info: OpenAiChatGptTokenInfo,
) {
  await SecureStore.setItemAsync(
    getAccountSessionKey(accountId),
    JSON.stringify(info),
  );
}

export async function getOpenAiChatGptTokenInfoForAccount(
  accountId: string,
): Promise<OpenAiChatGptTokenInfo> {
  return (
    parseTokenInfo(await SecureStore.getItemAsync(getAccountSessionKey(accountId))) ??
    EMPTY_TOKEN_INFO
  );
}

export async function getOpenAiChatGptTokenInfo(): Promise<OpenAiChatGptTokenInfo> {
  return (
    parseTokenInfo(await SecureStore.getItemAsync(LEGACY_SESSION_KEY)) ??
    EMPTY_TOKEN_INFO
  );
}

export async function setOpenAiChatGptTokensForAccount(
  accountId: string,
  input: {
    accessToken: string;
    clientId: string;
    email?: string | null;
    expiresIn?: number | null;
    idToken?: string | null;
    refreshToken?: string | null;
    scopes: string[];
  },
) {
  await persistTokenInfoForAccount(
    accountId,
    buildTokenInfo({
      clientId: input.clientId,
      email: input.email ?? null,
      expiresIn: input.expiresIn,
      idToken: input.idToken,
      refreshToken: input.refreshToken,
      scopes: input.scopes,
      tokens: { access_token: input.accessToken },
    }),
  );
}

export async function clearOpenAiChatGptTokensForAccount(accountId: string) {
  refreshPromiseForAccount.delete(accountId);
  await SecureStore.deleteItemAsync(getAccountSessionKey(accountId));
}

export async function clearLegacyOpenAiChatGptTokens() {
  legacyRefreshPromise = null;
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
}

export async function migrateLegacyOpenAiChatGptTokensToAccount(
  accountId: string,
) {
  const legacy = await getOpenAiChatGptTokenInfo();

  if (legacy.accessToken || legacy.refreshToken) {
    await persistTokenInfoForAccount(accountId, legacy);
  }

  await clearLegacyOpenAiChatGptTokens();
}

async function completeLogin(input: {
  accountId?: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  nonce: string;
}): Promise<OpenAiChatGptTokenInfo> {
  const tokens = await exchangeCodeForToken({
    clientId: input.clientId,
    code: input.code,
    codeVerifier: input.codeVerifier,
  });

  const scopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

  if (!scopes.includes(TOKEN_SHARING_SCOPE)) {
    throw new Error(
      "ChatGPT sign-in finished without plan-usage permission. Sign in again and allow ChatGPT plan usage, or connect OpenAI with an API key.",
    );
  }

  if (!tokens.id_token) {
    throw new Error("ChatGPT sign-in did not return an ID token.");
  }

  const claims = await verifyIdToken(tokens.id_token, input.clientId, input.nonce);
  const info = buildTokenInfo({
    clientId: input.clientId,
    email: typeof claims.email === "string" ? claims.email : null,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token ?? null,
    scopes,
    tokens,
  });

  if (input.accountId) {
    await persistTokenInfoForAccount(input.accountId, info);
  } else {
    await persistTokenInfo(info);
  }

  return info;
}

export async function handleChatGptLogin(options?: {
  accountId?: string;
}): Promise<OpenAiChatGptTokenInfo> {
  const hostId = await getAgentHostId();
  const pkce = await generatePkce();
  const state = randomValue();
  const nonce = randomValue();

  const existing = options?.accountId
    ? await getOpenAiChatGptTokenInfoForAccount(options.accountId)
    : await getOpenAiChatGptTokenInfo();
  const savedClientId = existing.clientId;

  const callbackPromise = new Promise<OpenAiChatGptTokenInfo>(
    (resolve, reject) => {
      void prepareLocalCallbackSession({
        expectedState: state,
        host: CALLBACK_HOST,
        path: CALLBACK_PATH,
        port: CALLBACK_PORT,
        onCallback: async ({ code, query, state: returnedState }) => {
          try {
            const error =
              query.get("error_description") ?? query.get("error");

            if (error) {
              throw new Error(error);
            }

            if (!code) {
              throw new Error("Missing authorization code.");
            }

            if (returnedState !== state) {
              throw new Error("OAuth state mismatch.");
            }

            const issuedClientId = query.get("client_id");

            if (
              savedClientId &&
              issuedClientId &&
              issuedClientId !== savedClientId
            ) {
              throw new Error(
                "ChatGPT returned a different client than this connection. Connect again.",
              );
            }

            const clientId = savedClientId ?? issuedClientId;

            if (!clientId) {
              throw new Error(
                "ChatGPT sign-in did not return a client ID. Connect again.",
              );
            }

            const info = await completeLogin({
              accountId: options?.accountId,
              clientId,
              code,
              codeVerifier: pkce.verifier,
              nonce,
            });

            resolve(info);
            void returnToAppAfterOAuth();
          } catch (errorValue) {
            reject(errorValue);
            throw errorValue;
          }
        },
      });
    },
  );

  const authUrl = buildAuthorizeUrl({
    hostId,
    nonce,
    pkceChallenge: pkce.challenge,
    savedClientId,
    state,
  });

  const { openBrowserAsync, dismissBrowser } = await import("expo-web-browser");
  const cancelWatcher = await watchForOAuthCancel(
    "ChatGPT sign-in was canceled before it completed.",
  );
  const browserPromise = openBrowserAsync(authUrl);
  browserPromise.catch(() => null);
  const browserClosedPromise = browserPromise.then((result) => {
    if (result.type === "opened") {
      return new Promise<never>(() => {});
    }

    const error = new Error(
      "ChatGPT sign-in was canceled before it completed.",
    );
    error.name = "OAuthCanceledError";
    throw error;
  });

  try {
    return await Promise.race([
      callbackPromise,
      browserClosedPromise,
      cancelWatcher.cancelPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Timed out waiting for the ChatGPT sign-in callback."));
        }, 180_000);
      }),
    ]);
  } finally {
    cancelWatcher.dispose();
    dismissBrowser();
  }
}

async function refreshTokenInfo(
  current: OpenAiChatGptTokenInfo,
  persist: (info: OpenAiChatGptTokenInfo) => Promise<void>,
): Promise<OpenAiChatGptTokenInfo> {
  if (!current.refreshToken || !current.clientId) {
    return current;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: current.clientId,
    refresh_token: current.refreshToken,
    resource: RESOURCE,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as
    | TokenResponse
    | Record<string, string>;

  if (!res.ok) {
    const errorData = data as Record<string, string>;
    throw new Error(
      errorData.error_description ||
        errorData.error ||
        "ChatGPT token refresh failed.",
    );
  }

  const tokens = data as TokenResponse;
  const next = buildTokenInfo({
    clientId: current.clientId,
    email: current.email,
    idToken: tokens.id_token ?? current.idToken,
    refreshToken: tokens.refresh_token ?? current.refreshToken,
    scopes: tokens.scope?.split(" ").filter(Boolean) ?? current.scopes,
    tokens,
  });

  await persist(next);
  return next;
}

function isFresh(info: OpenAiChatGptTokenInfo) {
  if (!info.accessToken) {
    return false;
  }

  if (info.expiresAt === null) {
    return true;
  }

  return info.expiresAt - REFRESH_SKEW_MS > Date.now();
}

export async function getValidOpenAiChatGptTokenInfoForAccount(
  accountId: string,
): Promise<OpenAiChatGptTokenInfo> {
  const current = await getOpenAiChatGptTokenInfoForAccount(accountId);

  if (isFresh(current)) {
    return current;
  }

  if (!current.refreshToken || !current.clientId) {
    return current;
  }

  let promise = refreshPromiseForAccount.get(accountId);

  if (!promise) {
    promise = refreshTokenInfo(current, (info) =>
      persistTokenInfoForAccount(accountId, info),
    ).finally(() => {
      refreshPromiseForAccount.delete(accountId);
    });
    refreshPromiseForAccount.set(accountId, promise);
  }

  return promise;
}

/**
 * Refreshes the access token even when it is not near expiry. Used when the
 * server rejects a locally-valid token (for example after it was revoked).
 */
export async function forceRefreshOpenAiChatGptTokenForAccount(
  accountId: string,
): Promise<OpenAiChatGptTokenInfo> {
  const current = await getOpenAiChatGptTokenInfoForAccount(accountId);

  if (!current.refreshToken || !current.clientId) {
    return current;
  }

  const promise = refreshTokenInfo(current, (info) =>
    persistTokenInfoForAccount(accountId, info),
  ).finally(() => {
    refreshPromiseForAccount.delete(accountId);
  });
  refreshPromiseForAccount.set(accountId, promise);

  return promise;
}

export async function getValidOpenAiChatGptTokenInfo(): Promise<OpenAiChatGptTokenInfo> {
  const current = await getOpenAiChatGptTokenInfo();

  if (isFresh(current)) {
    return current;
  }

  if (!current.refreshToken || !current.clientId) {
    return current;
  }

  if (!legacyRefreshPromise) {
    legacyRefreshPromise = refreshTokenInfo(current, persistTokenInfo).finally(
      () => {
        legacyRefreshPromise = null;
      },
    );
  }

  return legacyRefreshPromise;
}

export async function refreshOpenAiChatGptToken(
  current: OpenAiChatGptTokenInfo,
): Promise<OpenAiChatGptTokenInfo> {
  return refreshTokenInfo(current, async () => {});
}

export { TOKEN_SHARING_SCOPE };
