export type AuthorizationServerMetadata = {
  authorization_endpoint: string;
  issuer?: string;
  registration_endpoint?: string;
  token_endpoint: string;
};

export type ProtectedResourceMetadata = {
  authorization_servers?: string[];
  resource?: string;
  scopes_supported?: string[];
};

export type OAuthClientInformation = {
  client_id: string;
  client_secret?: string;
  token_endpoint?: string;
  authorization_server?: string;
};

const MCP_PROTOCOL_VERSION = "2025-11-25";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

export function buildWellKnownPath(type: string, pathname: string): string {
  const normalizedPath = pathname === "/" ? "" : pathname;
  return `/.well-known/${type}${normalizedPath}`;
}

export async function fetchDiscoveryDocument(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      Accept: "application/json",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new DiscoveryHttpError(
      url,
      response.status,
      `HTTP ${response.status} while loading discovery document from ${url}`,
    );
  }

  return response.json();
}

export class DiscoveryHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryHttpError";
  }
}

export function parseProtectedResourceMetadata(
  payload: unknown,
): ProtectedResourceMetadata {
  if (!isRecord(payload)) {
    throw new Error("Invalid OAuth protected resource metadata response.");
  }

  return {
    authorization_servers: readStringArray(payload.authorization_servers),
    resource: readString(payload.resource),
    scopes_supported: readStringArray(payload.scopes_supported),
  };
}

export function parseAuthorizationServerMetadata(
  payload: unknown,
): AuthorizationServerMetadata {
  if (!isRecord(payload)) {
    throw new Error("Invalid OAuth authorization server metadata response.");
  }

  const authorization_endpoint = readString(payload.authorization_endpoint);
  const token_endpoint = readString(payload.token_endpoint);

  if (!authorization_endpoint || !token_endpoint) {
    throw new Error("OAuth authorization server metadata is missing endpoints.");
  }

  return {
    authorization_endpoint,
    issuer: readString(payload.issuer),
    registration_endpoint: readString(payload.registration_endpoint),
    token_endpoint,
  };
}

function normalizeResourcePath(pathname: string): string {
  let path = pathname;
  while (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path || "/";
}

function resourceUrlFromServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.hash = "";
  return url.href;
}

function isAllowedResourceUrl(
  serverUrl: string,
  resourceUrl: string,
): boolean {
  const serverOrigin = new URL(serverUrl).origin;
  const resourceOrigin = new URL(resourceUrl).origin;

  if (serverOrigin !== resourceOrigin) {
    return false;
  }

  const serverPath = normalizeResourcePath(new URL(serverUrl).pathname);
  const resourcePath = normalizeResourcePath(new URL(resourceUrl).pathname);

  if (serverPath === "/") {
    return true;
  }

  return resourcePath === serverPath || resourcePath.startsWith(`${serverPath}/`);
}

export function resolveProtectedResourceUrl(
  serverUrl: string,
  resourceMetadata: ProtectedResourceMetadata,
): string {
  if (resourceMetadata.resource && isAllowedResourceUrl(serverUrl, resourceMetadata.resource)) {
    return resourceMetadata.resource;
  }
  return resourceUrlFromServerUrl(serverUrl);
}

/**
 * Discovers the OAuth protected resource metadata for an MCP server URL.
 * Returns `null` when the server exposes none (plain OAuth, no discovery).
 */
export async function discoverProtectedResourceMetadata(
  serverUrl: string,
): Promise<ProtectedResourceMetadata | null> {
  const url = new URL(serverUrl);
  const candidates = [buildWellKnownPath("oauth-protected-resource", url.pathname)];

  if (url.pathname !== "/") {
    candidates.push("/.well-known/oauth-protected-resource");
  }

  for (const candidate of candidates) {
    const candidateUrl = new URL(candidate, url.origin);
    candidateUrl.search = url.search;

    try {
      const payload = await fetchDiscoveryDocument(candidateUrl.href);
      return parseProtectedResourceMetadata(payload);
    } catch (error) {
      if (error instanceof DiscoveryHttpError && error.status >= 500) {
        throw error;
      }
      // 4xx or network error -> try the next candidate.
    }
  }

  return null;
}

export function buildAuthorizationMetadataUrls(
  authorizationServerUrl: string,
): string[] {
  const url = new URL(authorizationServerUrl);
  const pathname = url.pathname;

  if (pathname === "/") {
    return [
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ];
  }

  return [
    `/.well-known/oauth-authorization-server${pathname}`,
    "/.well-known/oauth-authorization-server",
    `/.well-known/openid-configuration${pathname}`,
    `${pathname}/.well-known/openid-configuration`,
  ];
}

export async function discoverAuthorizationServerMetadataCompat(
  authorizationServerUrl: string,
): Promise<AuthorizationServerMetadata> {
  const candidates = buildAuthorizationMetadataUrls(authorizationServerUrl);

  for (const candidate of candidates) {
    const url = new URL(candidate, authorizationServerUrl);

    try {
      const payload = await fetchDiscoveryDocument(url.href);
      return parseAuthorizationServerMetadata(payload);
    } catch (error) {
      if (error instanceof DiscoveryHttpError && error.status >= 500) {
        throw error;
      }
      // 4xx or network error -> try the next candidate.
    }
  }

  throw new Error("OAuth authorization server metadata could not be discovered.");
}

export type ClientRegistrationResult = OAuthClientInformation & {
  redirect_uri: string;
};

/**
 * RFC 7591 dynamic client registration against an MCP authorization server.
 */
export async function registerDiscoveryClient(
  metadata: AuthorizationServerMetadata,
  clientMetadata: Record<string, unknown>,
  redirectUri: string,
): Promise<ClientRegistrationResult> {
  const registrationEndpoint = metadata.registration_endpoint;

  if (!registrationEndpoint) {
    throw new Error(
      "This MCP server does not support dynamic client registration.",
    );
  }

  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(clientMetadata),
    redirect: "follow",
  });

  if (!response.ok) {
    let serverMessage = "";
    try {
      const body = (await response.json()) as Record<string, unknown>;
      if (typeof body.error === "string") serverMessage += ` ${body.error}`;
      if (typeof body.error_description === "string") {
        serverMessage += ` ${body.error_description}`;
      }
    } catch {
      // ignore parse failures
    }
    throw new Error(
      `OAuth client registration failed (${response.status}${serverMessage})`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OAuth client registration returned invalid JSON.");
  }

  if (!isRecord(payload) || typeof payload.client_id !== "string") {
    throw new Error("OAuth client registration did not return a client ID.");
  }

  const clientSecret = readString(payload.client_secret);

  return {
    client_id: payload.client_id,
    client_secret: clientSecret,
    token_endpoint: metadata.token_endpoint,
    authorization_server:
      metadata.issuer ||
      (typeof payload.authorization_server === "string"
        ? payload.authorization_server
        : undefined),
    redirect_uri: redirectUri,
  };
}

export function buildClientMetadata({
  clientName,
  redirectUris,
  scope,
}: {
  clientName: string;
  redirectUris: string[];
  scope?: string;
}): Record<string, unknown> {
  return {
    client_name: clientName,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: redirectUris,
    response_types: ["code"],
    ...(scope ? { scope } : {}),
    token_endpoint_auth_method: "none",
  };
}

/**
 * Runs discovery for an MCP server URL and returns everything needed to build
 * an authorization request. Skips protected-resource discovery when not
 * available and falls back to the bare resource URL.
 */
export async function discoverAuthServerForResource(
  serverUrl: string,
  authorizationServerUrlOverride?: string,
): Promise<{
  resourceUrl: string;
  resourceMetadata: ProtectedResourceMetadata | null;
  authServer: AuthorizationServerMetadata;
}> {
  const resourceMetadata = await discoverProtectedResourceMetadata(serverUrl);
  const resourceUrl = resourceMetadata
    ? resolveProtectedResourceUrl(serverUrl, resourceMetadata)
    : resourceUrlFromServerUrl(serverUrl);

  const authServerUrl =
    authorizationServerUrlOverride ??
    resourceMetadata?.authorization_servers?.[0] ??
    serverUrl;

  const authServer = await discoverAuthorizationServerMetadataCompat(authServerUrl);

  return { resourceUrl, resourceMetadata, authServer };
}