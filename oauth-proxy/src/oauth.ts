import type { OAuthProxyEnv } from "./config";
import type { Identity } from "./auth";
import type { OAuthClientInformation } from "./discovery";
import {
  buildClientMetadata,
  discoverAuthServerForResource,
  registerDiscoveryClient,
  type AuthorizationServerMetadata,
} from "./discovery";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  randomToken,
} from "./crypto";
import {
  deleteBeginTicket,
  deletePendingAuth,
  deleteSession,
  getBeginTicket,
  getPendingAuth,
  getSession,
  putBeginTicket,
  putPendingAuth,
  putSession,
  type StoredSession,
} from "./kv";
import {
  getAuthServerOverrides,
  getCallbackUrl,
  listProviderIds,
  resolveProvider,
  type ProxyProvider,
} from "./providers";

const REFRESH_SKEW_MS = 60_000;

export type AuthorizeParams = {
  provider: string;
  server?: string;
  extraState?: string;
};

export type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  tokenEndpoint: string,
  body: URLSearchParams,
  clientSecret?: string,
): Promise<TokenResponse> {
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "follow",
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`OAuth token endpoint returned invalid JSON (${response.status}).`);
  }

  const parsed = payload as Record<string, unknown>;

  if (!response.ok) {
    const error =
      typeof parsed.error === "string" ? parsed.error : `http_${response.status}`;
    const description =
      typeof parsed.error_description === "string"
        ? ` ${parsed.error_description}`
        : "";
    throw new Error(`OAuth token request failed: ${error}${description}`);
  }

  return parsed as TokenResponse;
}

export type ResolvedClient = {
  clientInfo: OAuthClientInformation;
  authServer: AuthorizationServerMetadata;
  resourceUrl?: string;
  scope?: string;
};

export async function resolveClientAndAuthServer(
  env: OAuthProxyEnv,
  provider: ProxyProvider,
  serverUrl: string | undefined,
): Promise<ResolvedClient> {
  const callbackUrl = getCallbackUrl(env, provider.id);
  const scope = provider.scope || undefined;
  const overrides = getAuthServerOverrides(provider);

  // 1. Static provider credentials (registered OAuth app).
  if (provider.mode === "static" && provider.clientId) {
    const discovered = overrides
      ? undefined
      : await discoverAuthServerForResource(serverUrl || provider.mcpUrl || "");

    const authServer: AuthorizationServerMetadata = overrides
      ? {
          authorization_endpoint: overrides.authorizationUrl,
          token_endpoint: overrides.tokenUrl,
          issuer: overrides.issuer,
        }
      : discovered!.authServer;

    return {
      clientInfo: {
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
      },
      authServer,
      resourceUrl: provider.useResourceParam ? discovered?.resourceUrl : undefined,
      scope,
    };
  }

  // 2. Direct override endpoints (no discovery needed).
  if (overrides) {
    return {
      clientInfo: { client_id: provider.id },
      authServer: {
        authorization_endpoint: overrides.authorizationUrl,
        token_endpoint: overrides.tokenUrl,
        issuer: overrides.issuer,
      },
      scope,
    };
  }

  // 3. Dynamic dispatch: discover + register our client as the authorize step.
  return discoverAndRegisterClient(env, provider, serverUrl, scope, callbackUrl);
}

async function discoverAndRegisterClient(
  env: OAuthProxyEnv,
  provider: ProxyProvider,
  serverUrl: string | undefined,
  scope: string | undefined,
  callbackUrl: string,
): Promise<ResolvedClient> {
  const { resourceUrl, resourceMetadata, authServer } =
    await discoverAuthServerForResource(serverUrl || provider.authorizationUrl || "");

  const resolvedScope = scope || resourceMetadata?.scopes_supported?.join(" ");

  const clientInfo = await registerDiscoveryClient(
    authServer,
    buildClientMetadata({
      clientName: "Mobile Agent",
      redirectUris: [callbackUrl],
      scope: resolvedScope,
    }),
    callbackUrl,
  );

  return { clientInfo, authServer, resourceUrl, scope: resolvedScope };
}

export async function buildAuthorizationParameters(
  env: OAuthProxyEnv,
  provider: ProxyProvider,
  identity: Identity,
  params: AuthorizeParams,
): Promise<{ url: string; state: string }> {
  const state = randomToken(24);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const resolved = await resolveClientAndAuthServer(
    env,
    provider,
    provider.mcpUrl,
  );
  const callbackUrl = getCallbackUrl(env, provider.id);
  const scope = resolved.scope || provider.scope;

  await putPendingAuth(env.PROXY_KV, state, {
    subject: identity.subject,
    provider: provider.id,
    server: params.server,
    codeVerifier,
    scope,
    resourceUrl: resolved.resourceUrl,
    authServer: resolved.authServer,
    clientInfo: resolved.clientInfo,
  });

  const authorizationUrl = new URL(resolved.authServer.authorization_endpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", resolved.clientInfo.client_id);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  if (scope) {
    authorizationUrl.searchParams.set("scope", scope);
  }

  if (provider.extraParams) {
    for (const [key, value] of Object.entries(provider.extraParams)) {
      authorizationUrl.searchParams.set(key, value);
    }
  }

  if (provider.useResourceParam && resolved.resourceUrl) {
    authorizationUrl.searchParams.set("resource", resolved.resourceUrl);
  }

  return { url: authorizationUrl.href, state };
}

export async function handleBeginRequest(
  env: OAuthProxyEnv,
  identity: Identity,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("provider")?.trim();
  const server = url.searchParams.get("server")?.trim() || undefined;

  if (!providerId) {
    return Response.json(
      { error: "missing_provider", error_description: "Missing provider id." },
      { status: 400 },
    );
  }

  const provider = resolveProvider(env, providerId);

  if (!provider) {
    return Response.json(
      { error: "unknown_provider", error_description: `Unknown provider "${providerId}".` },
      { status: 404 },
    );
  }

  const ticket = randomToken(24);
  await putBeginTicket(env.PROXY_KV, ticket, {
    subject: identity.subject,
    provider: providerId,
    server,
  });

  return Response.json(
    {
      ticket,
      authorizeUrl: `${env.BASE_URL.replace(/\/$/, "")}/oauth/authorize?ticket=${ticket}`,
    },
    { status: 200 },
  );
}

export async function handleAuthorizeRequest(
  env: OAuthProxyEnv,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket")?.trim();

  if (!ticket) {
    return Response.json(
      { error: "missing_ticket", error_description: "Missing authorization ticket." },
      { status: 401 },
    );
  }

  const begin = await getBeginTicket(env.PROXY_KV, ticket);
  await deleteBeginTicket(env.PROXY_KV, ticket);

  if (!begin) {
    return Response.json(
      { error: "invalid_ticket", error_description: "This authorization link has expired. Return to the app and try again." },
      { status: 401 },
    );
  }

  const provider = resolveProvider(env, begin.provider);

  if (!provider) {
    return Response.json(
      { error: "unknown_provider", error_description: `Unknown provider "${begin.provider}".` },
      { status: 404 },
    );
  }

  try {
    const { url: authorizationUrl } = await buildAuthorizationParameters(
      env,
      provider,
      { subject: begin.subject, installId: begin.subject },
      { provider: begin.provider, server: begin.server },
    );
    return Response.redirect(authorizationUrl, 302);
  } catch (error) {
    return Response.json(
      {
        error: "authorization_setup_failed",
        error_description:
          error instanceof Error ? error.message : "Failed to set up authorization.",
      },
      { status: 502 },
    );
  }
}

function successPage(title: string, message: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; background:#0b1220; color:#e2e8f0; display:grid; place-items:center; min-height:100vh; margin:0;">
<div style="text-align:center; padding: 2rem;"><h1 style="margin:0 0 .5rem;">${title}</h1><p style="margin:0; color:#94a3b8;">${message}</p></div>
</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function deepLinkRedirect(env: OAuthProxyEnv, params: URLSearchParams): Response {
  const base = new URL(env.APP_DEEP_LINK);
  for (const [key, value] of params.entries()) {
    base.searchParams.set(key, value);
  }
  return Response.redirect(base.href, 302);
}

export async function handleCallbackRequest(
  env: OAuthProxyEnv,
  request: Request,
  providerIdFromPath?: string,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim();
  const providerId = providerIdFromPath ?? url.searchParams.get("provider")?.trim();

  if (!providerId) {
    return successPage("Connection failed", "Missing provider id.");
  }

  if (!state) {
    return successPage("Connection failed", "Missing OAuth state (the request may be out of date).");
  }

  const pending = await getPendingAuth(env.PROXY_KV, state);
  await deletePendingAuth(env.PROXY_KV, state);

  if (!pending) {
    return successPage("Connection failed", "This authorization request has expired or already been used.");
  }

  const provider = resolveProvider(env, pending.provider);
  const callbackUrl = getCallbackUrl(env, pending.provider);
  const returnParams = new URLSearchParams({ provider: pending.provider });

  if (pending.server) {
    returnParams.set("server", pending.server);
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    returnParams.set(
      "error",
      url.searchParams.get("error_description") || oauthError,
    );
    return deepLinkRedirect(env, returnParams);
  }

  const code = url.searchParams.get("code");

  if (!code) {
    returnParams.set("error", "OAuth did not return an authorization code.");
    return deepLinkRedirect(env, returnParams);
  }

  if (!provider) {
    returnParams.set("error", `Unknown provider "${pending.provider}".`);
    return deepLinkRedirect(env, returnParams);
  }

  if (!pending.authServer || !pending.clientInfo) {
    returnParams.set("error", "Authorization setup was incomplete. Try again.");
    return deepLinkRedirect(env, returnParams);
  }

  try {
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: pending.clientInfo.client_id,
    });

    if (pending.codeVerifier) {
      tokenBody.set("code_verifier", pending.codeVerifier);
    }

    if (provider.useResourceParam && pending.resourceUrl) {
      tokenBody.set("resource", pending.resourceUrl);
    }

    const tokenResponse = await tokenRequest(
      pending.authServer.token_endpoint,
      tokenBody,
      pending.clientInfo.client_secret,
    );

    if (!tokenResponse.access_token) {
      throw new Error("OAuth token exchange did not return an access token.");
    }

    const proxyToken = randomToken(32);
    const expiresAt = tokenResponse.expires_in
      ? Date.now() + tokenResponse.expires_in * 1000
      : undefined;

    const session: StoredSession = {
      subject: pending.subject,
      provider: pending.provider,
      server: pending.server,
      flowType: "proxy",
      resourceUrl: pending.resourceUrl,
      authServer: {
        authorizationServerUrl: pending.authServer.issuer || pending.authServer.authorization_endpoint,
        tokenEndpoint: pending.authServer.token_endpoint,
      },
      clientInfo: pending.clientInfo,
      tokens: {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        expires_at: expiresAt,
        token_type: tokenResponse.token_type || "Bearer",
        scope: tokenResponse.scope || pending.scope,
      },
    };

    const ttlSeconds = session.tokens.refresh_token
      ? undefined
      : Math.max(60, Math.ceil(((expiresAt || Date.now() + 3600_000) - Date.now()) / 1000) + 300);

    await putSession(env.PROXY_KV, proxyToken, session, { ttlSeconds });

    returnParams.set("proxy", proxyToken);
    return deepLinkRedirect(env, returnParams);
  } catch (error) {
    returnParams.set(
      "error",
      error instanceof Error ? error.message : "Token exchange failed.",
    );
    return deepLinkRedirect(env, returnParams);
  }
}

function readProxyToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return new URL(request.url).searchParams.get("proxy")?.trim() || null;
}

async function loadSessionForIdentity(
  env: OAuthProxyEnv,
  identity: Identity,
  request: Request,
): Promise<{ session: StoredSession; proxyToken: string } | null> {
  const proxyToken = readProxyToken(request);

  if (!proxyToken) {
    return null;
  }

  const session = await getSession(env.PROXY_KV, proxyToken);

  if (!session || session.subject !== identity.subject) {
    return null;
  }

  return { session, proxyToken };
}

export type RefreshResult = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export async function performRefresh(
  env: OAuthProxyEnv,
  session: StoredSession,
  clientSecret?: string,
): Promise<RefreshResult | null> {
  const refreshToken = session.tokens.refresh_token;

  if (!refreshToken || !session.authServer) {
    return null;
  }

  const tokenBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: session.clientInfo?.client_id || session.provider,
  });

  const resourceUrl = session.resourceUrl;

  if (resourceUrl) {
    tokenBody.set("resource", resourceUrl);
  }

  const response = await tokenRequest(
    session.authServer.tokenEndpoint,
    tokenBody,
    clientSecret || session.clientInfo?.client_secret,
  );

  if (!response.access_token) {
    return null;
  }

  return {
    access_token: response.access_token,
    expires_in: response.expires_in,
    refresh_token: response.refresh_token,
    scope: response.scope,
    token_type: response.token_type,
  };
}

export async function handleTokenRequest(
  env: OAuthProxyEnv,
  identity: Identity,
  request: Request,
): Promise<Response> {
  const loaded = await loadSessionForIdentity(env, identity, request);

  if (!loaded) {
    return Response.json(
      { error: "invalid_session", error_description: "No active OAuth session for this proxy token." },
      { status: 401 },
    );
  }

  const { session, proxyToken } = loaded;
  const now = Date.now();
  const expiresAt = session.tokens.expires_at || 0;
  const dueForRefresh =
    session.tokens.refresh_token &&
    (expiresAt === 0 || expiresAt - now < REFRESH_SKEW_MS);

  try {
    if (dueForRefresh) {
      const refreshed = await performRefresh(env, session);

      if (refreshed) {
        session.tokens = {
          ...session.tokens,
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? session.tokens.refresh_token,
          scope: refreshed.scope ?? session.tokens.scope,
          token_type: refreshed.token_type ?? session.tokens.token_type,
          expires_at: refreshed.expires_in
            ? now + refreshed.expires_in * 1000
            : undefined,
        };
        await putSession(env.PROXY_KV, proxyToken, session);
      } else {
        return Response.json(
          { error: "session_expired", error_description: "OAuth session expired and cannot be refreshed. Reconnect the server." },
          { status: 401 },
        );
      }
    }

    if (!session.tokens.access_token) {
      return Response.json(
        { error: "session_expired", error_description: "OAuth session is missing an access token." },
        { status: 401 },
      );
    }

    const expiresIn = session.tokens.expires_at
      ? Math.max(0, Math.floor((session.tokens.expires_at - Date.now()) / 1000))
      : undefined;

    return Response.json({
      access_token: session.tokens.access_token,
      token_type: session.tokens.token_type || "Bearer",
      expires_in: expiresIn,
      refresh_token: session.tokens.refresh_token,
      scope: session.tokens.scope,
      authorization_server: session.authServer?.authorizationServerUrl,
      token_endpoint: session.authServer?.tokenEndpoint,
    });
  } catch (error) {
    return Response.json(
      {
        error: "refresh_failed",
        error_description: error instanceof Error ? error.message : "Token refresh failed.",
      },
      { status: 502 },
    );
  }
}

export async function handleRefreshRequest(
  env: OAuthProxyEnv,
  identity: Identity,
  request: Request,
): Promise<Response> {
  const loaded = await loadSessionForIdentity(env, identity, request);

  if (!loaded) {
    return Response.json(
      { error: "invalid_session", error_description: "No active OAuth session for this proxy token." },
      { status: 401 },
    );
  }

  const { session, proxyToken } = loaded;

  try {
    const refreshed = await performRefresh(env, session);

    if (!refreshed) {
      return Response.json(
        { error: "session_expired", error_description: "OAuth session cannot be refreshed. Reconnect the server." },
        { status: 401 },
      );
    }

    session.tokens = {
      ...session.tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? session.tokens.refresh_token,
      scope: refreshed.scope ?? session.tokens.scope,
      token_type: refreshed.token_type ?? session.tokens.token_type,
      expires_at: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : undefined,
    };
    await putSession(env.PROXY_KV, proxyToken, session);

    return Response.json({
      access_token: refreshed.access_token,
      token_type: refreshed.token_type ?? session.tokens.token_type ?? "Bearer",
      expires_in: refreshed.expires_in,
      refresh_token: refreshed.refresh_token ?? session.tokens.refresh_token,
      scope: refreshed.scope ?? session.tokens.scope,
      authorization_server: session.authServer?.authorizationServerUrl,
      token_endpoint: session.authServer?.tokenEndpoint,
    });
  } catch (error) {
    return Response.json(
      {
        error: "refresh_failed",
        error_description: error instanceof Error ? error.message : "Token refresh failed.",
      },
      { status: 502 },
    );
  }
}

export async function handleRevokeRequest(
  env: OAuthProxyEnv,
  identity: Identity,
  request: Request,
): Promise<Response> {
  const loaded = await loadSessionForIdentity(env, identity, request);

  if (!loaded) {
    return Response.json({ ok: true }, { status: 200 });
  }

  await deleteSession(env.PROXY_KV, loaded.proxyToken);
  return Response.json({ ok: true }, { status: 200 });
}

export async function handleHealthRequest(env: OAuthProxyEnv): Promise<Response> {
  await env.PROXY_KV.get("health:ping");
  return Response.json(
    { ok: true, service: "mobile-agent-oauth-proxy", providers: listProviderIds() },
    { status: 200 },
  );
}