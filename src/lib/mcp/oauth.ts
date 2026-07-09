import { initializeCrypto } from "@/lib/crypto";
import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import {
  AuthRequest,
  CodeChallengeMethod,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  ResponseType,
  type DiscoveryDocument,
} from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import "react-native-get-random-values";

import { secureSecretStore, type McpOAuthSession } from "@/lib/secrets";
import type { McpServerConfig } from "@/types/app-state";
import { Platform } from "react-native";

const REFRESH_SKEW_MS = 60_000;
const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_OAUTH_CANCELED_ERROR_NAME = "McpOAuthCanceledError";

type AuthorizationServerMetadata = {
  authorization_endpoint: string;
  issuer?: string;
  registration_endpoint?: string;
  token_endpoint: string;
};

type ProtectedResourceMetadata = {
  authorization_servers?: string[];
  resource?: string;
};

let cryptoInstalled = false;

async function ensureCryptoInstalled() {
  if (Platform.OS === "web") return;

  if (!cryptoInstalled) {
    const { install } = await import("react-native-quick-crypto");
    install();
    cryptoInstalled = true;
  }
}

async function getAuth() {
  const { auth } = await import("@ai-sdk/mcp");
  return auth;
}

function createMcpOAuthCanceledError(message = "MCP OAuth was canceled.") {
  const error = new Error(message);
  error.name = MCP_OAUTH_CANCELED_ERROR_NAME;
  return error;
}

export function isMcpOAuthCanceledError(error: unknown) {
  return (
    error instanceof Error && error.name === MCP_OAUTH_CANCELED_ERROR_NAME
  );
}

function getRequiredOAuthField(value: string | null, label: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${label} is required for MCP OAuth.`);
  }

  return trimmed;
}

function splitScopes(value: string | null) {
  return (
    value
      ?.split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean) ?? []
  );
}

function getScopeString(server: McpServerConfig) {
  const scopes = splitScopes(server.oauthScopes);
  return scopes.length > 0 ? scopes.join(" ") : undefined;
}

function validateOAuthOrigin(
  server: McpServerConfig,
  authorizationUrl: string,
) {
  const configuredOrigin = server.oauthAllowedAuthOrigin?.trim();
  const fallbackOrigin = server.oauthAuthorizationUrl?.trim()
    ? new URL(server.oauthAuthorizationUrl).origin
    : null;
  const expectedOrigin = configuredOrigin || fallbackOrigin;

  if (!expectedOrigin) {
    return;
  }

  const actualOrigin = new URL(authorizationUrl).origin;

  if (actualOrigin !== expectedOrigin) {
    throw new Error(
      `OAuth authorization origin ${actualOrigin} does not match ${expectedOrigin}.`,
    );
  }
}

function hasManualOAuthConfiguration(server: McpServerConfig) {
  return Boolean(
    server.oauthClientId?.trim() &&
    server.oauthAuthorizationUrl?.trim() &&
    server.oauthTokenUrl?.trim(),
  );
}

function buildManualClientInformation(server: McpServerConfig) {
  const clientId = server.oauthClientId?.trim();
  return clientId ? { client_id: clientId } : undefined;
}

function getStoredSessionValue<T>(
  session: McpOAuthSession | null,
  key: keyof McpOAuthSession,
) {
  const value = session?.[key];
  return (value ?? null) as T | null;
}

function buildStoredTokens(session: McpOAuthSession | null) {
  const tokens = getStoredSessionValue<OAuthTokens>(session, "tokens");

  if (!tokens?.access_token) {
    return null;
  }

  return tokens;
}

function isIssuerMismatchError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("authorization server metadata issuer") &&
    error.message.includes("does not match expected issuer")
  );
}

function shouldRefreshSession(session: McpOAuthSession | null) {
  return Boolean(
    session?.tokens?.refresh_token &&
    session.expiresAt &&
    session.expiresAt - Date.now() < REFRESH_SKEW_MS,
  );
}

function resolveSessionExpiry(tokens: OAuthTokens) {
  return typeof tokens.expires_in === "number"
    ? Date.now() + tokens.expires_in * 1000
    : null;
}

function getDiscoveryOAuthRedirectUri() {
  return makeRedirectUri({
    scheme: "mobile-agent",
    path: "mcp/oauth/callback",
  });
}

function normalizeUrl(value: string | URL) {
  return new URL(value).href;
}

function normalizeResourcePath(pathname: string) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function resourceUrlFromServerUrl(serverUrl: string | URL) {
  const url = new URL(serverUrl);
  url.hash = "";
  return url.href;
}

function resourceUrlStripSlash(resourceUrl: string | URL) {
  const normalized = resourceUrlFromServerUrl(resourceUrl);
  const url = new URL(normalized);
  return url.pathname === "/" && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function isAllowedResourceUrl(serverUrl: string, resourceUrl: string) {
  const server = new URL(serverUrl);
  const resource = new URL(resourceUrl);

  if (server.origin !== resource.origin) {
    return false;
  }

  const serverPath = normalizeResourcePath(server.pathname);
  const resourcePath = normalizeResourcePath(resource.pathname);

  if (serverPath === "/") {
    return true;
  }

  return (
    resourcePath === serverPath || resourcePath.startsWith(`${serverPath}/`)
  );
}

function resolveProtectedResourceUrl(
  serverUrl: string,
  resourceMetadata: ProtectedResourceMetadata | null,
) {
  const configuredResource = resourceMetadata?.resource?.trim();

  if (!configuredResource) {
    return resourceUrlStripSlash(serverUrl);
  }

  if (!isAllowedResourceUrl(serverUrl, configuredResource)) {
    throw new Error(
      `OAuth protected resource ${configuredResource} does not match ${serverUrl}.`,
    );
  }

  return resourceUrlStripSlash(configuredResource);
}

function buildWellKnownPath(
  type: "oauth-authorization-server" | "oauth-protected-resource",
  pathname: string,
) {
  if (!pathname || pathname === "/") {
    return `/.well-known/${type}`;
  }

  const normalizedPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return `/.well-known/${type}${normalizedPath}`;
}

async function fetchDiscoveryDocument(url: URL) {
  return fetch(url, {
    headers: {
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      Accept: "application/json",
    },
  });
}

function parseProtectedResourceMetadata(
  payload: unknown,
): ProtectedResourceMetadata {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid OAuth protected resource metadata response.");
  }

  const authorizationServers = Array.isArray(
    (payload as { authorization_servers?: unknown }).authorization_servers,
  )
    ? (payload as { authorization_servers: unknown[] }).authorization_servers.filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      )
    : undefined;

  return {
    authorization_servers: authorizationServers,
    resource:
      typeof (payload as { resource?: unknown }).resource === "string" &&
      (payload as { resource: string }).resource.trim()
        ? (payload as { resource: string }).resource
        : undefined,
  };
}

function parseAuthorizationServerMetadata(
  payload: unknown,
): AuthorizationServerMetadata {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid OAuth authorization server metadata response.");
  }

  const record = payload as Record<string, unknown>;

  if (
    typeof record.authorization_endpoint !== "string" ||
    typeof record.token_endpoint !== "string"
  ) {
    throw new Error("OAuth authorization server metadata is missing endpoints.");
  }

  return {
    authorization_endpoint: record.authorization_endpoint,
    issuer: typeof record.issuer === "string" ? record.issuer : undefined,
    registration_endpoint:
      typeof record.registration_endpoint === "string"
        ? record.registration_endpoint
        : undefined,
    token_endpoint: record.token_endpoint,
  };
}

async function discoverProtectedResourceMetadata(serverUrl: string) {
  const url = new URL(serverUrl);
  const primaryUrl = new URL(
    buildWellKnownPath("oauth-protected-resource", url.pathname),
    url.origin,
  );
  primaryUrl.search = url.search;

  const candidates = [primaryUrl];

  if (url.pathname !== "/") {
    candidates.push(new URL("/.well-known/oauth-protected-resource", url.origin));
  }

  for (const candidate of candidates) {
    const response = await fetchDiscoveryDocument(candidate);

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        continue;
      }

      throw new Error(
        `HTTP ${response.status} trying to load OAuth protected resource metadata.`,
      );
    }

    return parseProtectedResourceMetadata(await response.json());
  }

  return null;
}

function buildAuthorizationMetadataUrls(authorizationServerUrl: string) {
  const url = new URL(authorizationServerUrl);
  const hasPath = url.pathname !== "/";
  const urls: URL[] = [];

  if (!hasPath) {
    urls.push(new URL("/.well-known/oauth-authorization-server", url.origin));
    urls.push(new URL("/.well-known/openid-configuration", url.origin));
    return urls;
  }

  const pathname = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;

  urls.push(
    new URL(`/.well-known/oauth-authorization-server${pathname}`, url.origin),
  );
  urls.push(new URL("/.well-known/oauth-authorization-server", url.origin));
  urls.push(new URL(`/.well-known/openid-configuration${pathname}`, url.origin));
  urls.push(new URL(`${pathname}/.well-known/openid-configuration`, url.origin));

  return urls;
}

async function discoverAuthorizationServerMetadataCompat(
  authorizationServerUrl: string,
) {
  for (const url of buildAuthorizationMetadataUrls(authorizationServerUrl)) {
    const response = await fetchDiscoveryDocument(url);

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        continue;
      }

      throw new Error(
        `HTTP ${response.status} trying to load OAuth authorization server metadata.`,
      );
    }

    return parseAuthorizationServerMetadata(await response.json());
  }

  throw new Error("OAuth authorization server metadata could not be discovered.");
}

async function registerDiscoveryClient(input: {
  metadata: AuthorizationServerMetadata;
  provider: OAuthClientProvider;
}) {
  if (!input.metadata.registration_endpoint) {
    throw new Error(
      "This MCP server requires a client ID. Open Advanced OAuth overrides and add it there.",
    );
  }

  const response = await fetch(input.metadata.registration_endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.provider.clientMetadata),
  });

  if (!response.ok) {
    throw new Error(
      `OAuth client registration failed (${response.status}). Add a client ID in Advanced OAuth overrides and try again.`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;

  if (typeof payload.client_id !== "string" || !payload.client_id.trim()) {
    throw new Error("OAuth client registration did not return a client ID.");
  }

  return {
    client_id: payload.client_id,
    client_secret:
      typeof payload.client_secret === "string" && payload.client_secret.trim()
        ? payload.client_secret
        : undefined,
    token_endpoint:
      typeof input.metadata.token_endpoint === "string"
        ? input.metadata.token_endpoint
        : undefined,
    authorization_server:
      typeof input.metadata.issuer === "string" && input.metadata.issuer.trim()
        ? input.metadata.issuer
        : undefined,
  } satisfies OAuthClientInformation;
}

async function connectCompatibleDiscoveredMcpOAuth(server: McpServerConfig) {
  const provider = buildDiscoveryOAuthProvider(server, { interactive: true });
  const resourceMetadata = await discoverProtectedResourceMetadata(server.url);
  const resourceUrl = resolveProtectedResourceUrl(server.url, resourceMetadata);
  const authorizationServerUrl =
    resourceMetadata?.authorization_servers?.[0]?.trim() || server.url;

  await provider.validateAuthorizationServerURL?.(
    server.url,
    authorizationServerUrl,
  );

  const metadata =
    await discoverAuthorizationServerMetadataCompat(authorizationServerUrl);

  validateOAuthOrigin(server, metadata.authorization_endpoint);

  let clientInformation = await provider.clientInformation();

  if (!clientInformation) {
    clientInformation = await registerDiscoveryClient({ metadata, provider });
    await provider.saveClientInformation?.(clientInformation);
  }

  const redirectUri = getDiscoveryOAuthRedirectUri();
  const request = new AuthRequest({
    clientId: clientInformation.client_id,
    clientSecret: clientInformation.client_secret,
    codeChallengeMethod: CodeChallengeMethod.S256,
    extraParams: { resource: resourceUrl },
    redirectUri,
    responseType: ResponseType.Code,
    scopes: splitScopes(server.oauthScopes),
    usePKCE: true,
  });
  const discovery: DiscoveryDocument = {
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
  };
  const result = await request.promptAsync(discovery);

  if (result.type !== "success") {
    throw createMcpOAuthCanceledError();
  }

  const code = result.params.code;

  if (!code) {
    throw new Error("MCP OAuth did not return an authorization code.");
  }

  const tokenResponse = await exchangeCodeAsync(
    {
      clientId: clientInformation.client_id,
      clientSecret: clientInformation.client_secret,
      code,
      extraParams: {
        ...(request.codeVerifier
          ? { code_verifier: request.codeVerifier }
          : {}),
        resource: resourceUrl,
      },
      redirectUri,
    },
    { tokenEndpoint: metadata.token_endpoint },
  );

  const currentSession = await secureSecretStore.getMcpOAuthSession(server.id);
  const authorizationServerInformation: OAuthAuthorizationServerInformation = {
    authorizationServerUrl: normalizeUrl(
      metadata.issuer?.trim() ? metadata.issuer : authorizationServerUrl,
    ),
    tokenEndpoint: normalizeUrl(metadata.token_endpoint),
  };

  await secureSecretStore.setMcpOAuthSession(server.id, {
    ...(currentSession ?? {}),
    authorizationServerInformation,
    clientInformation,
    codeVerifier: null,
    expiresAt: tokenResponse.expiresIn
      ? Date.now() + tokenResponse.expiresIn * 1000
      : null,
    flowType: "compat",
    resourceUrl,
    state: null,
    tokens: {
      access_token: tokenResponse.accessToken,
      authorization_server: authorizationServerInformation.authorizationServerUrl,
      expires_in: tokenResponse.expiresIn ?? undefined,
      refresh_token: tokenResponse.refreshToken ?? undefined,
      token_endpoint: authorizationServerInformation.tokenEndpoint,
      token_type: tokenResponse.tokenType ?? "Bearer",
    },
  });
}

async function refreshCompatibleDiscoveredMcpAccessToken(server: McpServerConfig) {
  const session = await secureSecretStore.getMcpOAuthSession(server.id);

  if (!session?.tokens?.access_token) {
    return null;
  }

  const refreshToken = session.tokens.refresh_token ?? null;
  const needsResourceMigration = !session.resourceUrl?.trim();

  if (!needsResourceMigration && !shouldRefreshSession(session)) {
    return session.tokens.access_token;
  }

  if (!refreshToken) {
    if (needsResourceMigration) {
      throw new Error(
        "Reconnect this MCP server to refresh the saved OAuth session.",
      );
    }

    return session.tokens.access_token;
  }

  const clientId = session.clientInformation?.client_id?.trim();
  const tokenEndpoint =
    session.authorizationServerInformation?.tokenEndpoint?.trim() ||
    session.tokens.token_endpoint?.trim();

  if (!clientId || !tokenEndpoint) {
    throw new Error("Stored MCP OAuth session is missing refresh settings.");
  }

  const resourceUrl =
    session.resourceUrl?.trim() ||
    resolveProtectedResourceUrl(
      server.url,
      await discoverProtectedResourceMetadata(server.url),
    );

  const refreshed = await refreshAsync(
    {
      clientId,
      clientSecret: session.clientInformation?.client_secret,
      extraParams: { resource: resourceUrl },
      refreshToken,
    },
    { tokenEndpoint },
  );

  await secureSecretStore.setMcpOAuthSession(server.id, {
    ...session,
    expiresAt: refreshed.expiresIn
      ? Date.now() + refreshed.expiresIn * 1000
      : null,
    flowType: "compat",
    resourceUrl,
    tokens: {
      access_token: refreshed.accessToken,
      authorization_server:
        session.authorizationServerInformation?.authorizationServerUrl ??
        session.tokens.authorization_server,
      expires_in: refreshed.expiresIn ?? undefined,
      refresh_token: refreshed.refreshToken ?? refreshToken,
      token_endpoint: tokenEndpoint,
      token_type: refreshed.tokenType ?? session.tokens.token_type ?? "Bearer",
    },
  });

  return refreshed.accessToken;
}

function buildDiscoveryOAuthProvider(
  server: McpServerConfig,
  options: {
    interactive: boolean;
  },
): OAuthClientProvider {
  const redirectUrl = getDiscoveryOAuthRedirectUri();
  const scope = getScopeString(server);
  let provider: OAuthClientProvider;
  let sessionPromise: Promise<McpOAuthSession | null> | null = null;

  const loadSession = async () => {
    if (!sessionPromise) {
      sessionPromise = secureSecretStore.getMcpOAuthSession(server.id);
    }

    return (await sessionPromise) ?? null;
  };

  const saveSession = async (nextSession: McpOAuthSession) => {
    sessionPromise = Promise.resolve(nextSession);
    await secureSecretStore.setMcpOAuthSession(server.id, nextSession);
  };

  const updateSession = async (
    updater: (current: McpOAuthSession | null) => McpOAuthSession,
  ) => {
    const current = await loadSession();
    const next = updater(current);
    await saveSession(next);
  };

  provider = {
    async tokens() {
      return buildStoredTokens(await loadSession()) ?? undefined;
    },
    async saveTokens(tokens) {
      await updateSession((current) => ({
        ...(current ?? {}),
        expiresAt: resolveSessionExpiry(tokens),
        tokens,
      }));
    },
    async redirectToAuthorization(authorizationUrl) {
      validateOAuthOrigin(server, authorizationUrl.href);

      if (!options.interactive) {
        throw new Error(
          "MCP OAuth authorization expired. Reconnect this server to continue.",
        );
      }

      const result = await WebBrowser.openAuthSessionAsync(
        authorizationUrl.href,
        redirectUrl,
      );

      if (result.type !== "success") {
        throw createMcpOAuthCanceledError();
      }

      const callbackUrl = new URL(result.url);
      const code = callbackUrl.searchParams.get("code");
      const error = callbackUrl.searchParams.get("error");
      const errorDescription =
        callbackUrl.searchParams.get("error_description");

      if (!code) {
        if (error) {
          if (error === "access_denied") {
            throw createMcpOAuthCanceledError(
              errorDescription || "MCP OAuth was canceled.",
            );
          }

          throw new Error(
            errorDescription ? `${error}: ${errorDescription}` : error,
          );
        }

        throw new Error("MCP OAuth did not return an authorization code.");
      }

      await (
        await getAuth()
      )(provider, {
        authorizationCode: code,
        callbackState: callbackUrl.searchParams.get("state") ?? undefined,
        scope,
        serverUrl: server.url,
      });
    },
    async saveCodeVerifier(codeVerifier) {
      await updateSession((current) => ({
        ...(current ?? {}),
        codeVerifier,
      }));
    },
    async codeVerifier() {
      const codeVerifier = getStoredSessionValue<string>(
        await loadSession(),
        "codeVerifier",
      );

      if (!codeVerifier) {
        throw new Error("MCP OAuth code verifier is missing.");
      }

      return codeVerifier;
    },
    async invalidateCredentials(scopeToInvalidate) {
      await updateSession((current) => {
        const next = { ...(current ?? {}) };

        if (scopeToInvalidate === "all" || scopeToInvalidate === "client") {
          next.clientInformation = null;
          next.authorizationServerInformation = null;
        }

        if (scopeToInvalidate === "all" || scopeToInvalidate === "tokens") {
          next.tokens = null;
          next.expiresAt = null;
        }

        if (scopeToInvalidate === "all" || scopeToInvalidate === "verifier") {
          next.codeVerifier = null;
          next.state = null;
        }

        return next;
      });
    },
    get redirectUrl() {
      return redirectUrl;
    },
    get clientMetadata() {
      return {
        client_name: "mobile-agent",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [redirectUrl],
        response_types: ["code"],
        scope,
        token_endpoint_auth_method: "none",
      };
    },
    async clientInformation() {
      const session = await loadSession();
      return session?.clientInformation ?? buildManualClientInformation(server);
    },
    async saveClientInformation(clientInformation) {
      await updateSession((current) => ({
        ...(current ?? {}),
        clientInformation,
      }));
    },
    async authorizationServerInformation() {
      return (
        getStoredSessionValue(
          await loadSession(),
          "authorizationServerInformation",
        ) ?? undefined
      );
    },
    async saveAuthorizationServerInformation(authorizationServerInformation) {
      await updateSession((current) => ({
        ...(current ?? {}),
        authorizationServerInformation,
      }));
    },
    async validateAuthorizationServerURL(_, authorizationServerUrl) {
      validateOAuthOrigin(server, String(authorizationServerUrl));
    },
    state() {
      return Crypto.randomUUID();
    },
    async saveState(state) {
      await updateSession((current) => ({
        ...(current ?? {}),
        state,
      }));
    },
    async storedState() {
      return (
        getStoredSessionValue<string>(await loadSession(), "state") ?? undefined
      );
    },
  };

  return provider;
}

async function connectDiscoveredMcpOAuth(server: McpServerConfig) {
  try {
    await (
      await getAuth()
    )(buildDiscoveryOAuthProvider(server, { interactive: true }), {
      scope: getScopeString(server),
      serverUrl: server.url,
    });
    const session = await secureSecretStore.getMcpOAuthSession(server.id);

    if (session) {
      await secureSecretStore.setMcpOAuthSession(server.id, {
        ...session,
        flowType: "discovered",
      });
    }
  } catch (error) {
    if (isIssuerMismatchError(error)) {
      await connectCompatibleDiscoveredMcpOAuth(server);
      return;
    }

    if (
      error instanceof Error &&
      error.message.includes("dynamic client registration")
    ) {
      throw new Error(
        "This MCP server requires a client ID. Open Advanced OAuth overrides and add it there.",
      );
    }

    throw error;
  }
}

async function refreshDiscoveredMcpAccessToken(server: McpServerConfig) {
  const session = await secureSecretStore.getMcpOAuthSession(server.id);

  if (!session?.tokens?.access_token) {
    return null;
  }

  if (!shouldRefreshSession(session)) {
    return session.tokens.access_token;
  }
  await (
    await getAuth()
  )(buildDiscoveryOAuthProvider(server, { interactive: false }), {
    scope: getScopeString(server),
    serverUrl: server.url,
  });

  return (
    (await secureSecretStore.getMcpOAuthSession(server.id))?.tokens
      ?.access_token ?? null
  );
}

async function connectManualMcpOAuth(server: McpServerConfig) {
  const clientId = getRequiredOAuthField(server.oauthClientId, "Client ID");
  const authorizationEndpoint = getRequiredOAuthField(
    server.oauthAuthorizationUrl,
    "Authorization URL",
  );
  const tokenEndpoint = getRequiredOAuthField(
    server.oauthTokenUrl,
    "Token URL",
  );

  validateOAuthOrigin(server, authorizationEndpoint);

  const redirectUri = getMcpOAuthRedirectUri();
  const request = new AuthRequest({
    clientId,
    codeChallengeMethod: CodeChallengeMethod.S256,
    redirectUri,
    responseType: ResponseType.Code,
    scopes: splitScopes(server.oauthScopes),
    usePKCE: true,
  });
  const discovery: DiscoveryDocument = {
    authorizationEndpoint,
    tokenEndpoint,
  };
  const result = await request.promptAsync(discovery);

  if (result.type !== "success") {
    throw createMcpOAuthCanceledError();
  }

  const code = result.params.code;

  if (!code) {
    throw new Error("MCP OAuth did not return an authorization code.");
  }

  const tokenResponse = await exchangeCodeAsync(
    {
      clientId,
      code,
      extraParams: request.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : undefined,
      redirectUri,
    },
    { tokenEndpoint },
  );

  await secureSecretStore.setMcpOAuthTokens(server.id, {
    accessToken: tokenResponse.accessToken,
    expiresAt: tokenResponse.expiresIn
      ? Date.now() + tokenResponse.expiresIn * 1000
      : null,
    refreshToken: tokenResponse.refreshToken ?? null,
    tokenType: tokenResponse.tokenType ?? "Bearer",
  });

  const session = await secureSecretStore.getMcpOAuthSession(server.id);

  if (session) {
    await secureSecretStore.setMcpOAuthSession(server.id, {
      ...session,
      flowType: "manual",
    });
  }
}

async function refreshManualMcpAccessToken(server: McpServerConfig) {
  const tokens = await secureSecretStore.getMcpOAuthTokens(server.id);

  if (!tokens) {
    return null;
  }

  const shouldRefresh =
    tokens.refreshToken &&
    tokens.expiresAt &&
    tokens.expiresAt - Date.now() < REFRESH_SKEW_MS;

  if (!shouldRefresh) {
    return tokens.accessToken;
  }

  const clientId = getRequiredOAuthField(server.oauthClientId, "Client ID");
  const tokenEndpoint = getRequiredOAuthField(
    server.oauthTokenUrl,
    "Token URL",
  );
  const refreshed = await refreshAsync(
    {
      clientId,
      refreshToken: tokens.refreshToken ?? undefined,
    },
    { tokenEndpoint },
  );

  await secureSecretStore.setMcpOAuthTokens(server.id, {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresIn
      ? Date.now() + refreshed.expiresIn * 1000
      : null,
    refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    tokenType: refreshed.tokenType ?? tokens.tokenType ?? "Bearer",
  });

  return refreshed.accessToken;
}

export function getMcpOAuthRedirectUri() {
  return makeRedirectUri({
    scheme: "mobile-agent",
    path: "mcp/oauth/callback",
  });
}

export async function connectMcpOAuth(server: McpServerConfig) {
  try {
    await initializeCrypto();
    if (hasManualOAuthConfiguration(server)) {
      await connectManualMcpOAuth(server);
      return;
    }

    await connectDiscoveredMcpOAuth(server);
  } catch (error) {
    if (!isMcpOAuthCanceledError(error)) {
      console.error(error);
      if (error instanceof Error) console.error(error.stack);
    }

    throw error;
  }
}

export async function getMcpOAuthAccessToken(server: McpServerConfig) {
  try {
    await initializeCrypto();
    const session = await secureSecretStore.getMcpOAuthSession(server.id);

    if (session?.flowType === "compat") {
      return refreshCompatibleDiscoveredMcpAccessToken(server);
    }

    if (hasManualOAuthConfiguration(server)) {
      return refreshManualMcpAccessToken(server);
    }

    return refreshDiscoveredMcpAccessToken(server);
  } catch (error) {
    if (!isMcpOAuthCanceledError(error)) {
      console.error(error);
      if (error instanceof Error) console.error(error.stack);
    }

    throw error;
  }
}
