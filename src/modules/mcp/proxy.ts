import type { OAuthTokens } from "@ai-sdk/mcp";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { secureSecretStore } from "@/core/services/secrets";
import type { McpServerConfig } from "@/core/types/app-state";

const PROXY_CLIENT_KEY_SECURE_KEY = "mcp_oauth_proxy_client_key";

export function getMcpOAuthProxyBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_MCP_OAUTH_PROXY_URL ?? "").trim();
}

export function isMcpOAuthProxyConfigured(): boolean {
  return getMcpOAuthProxyBaseUrl().length > 0;
}

const PROVIDER_BY_HOSTNAME: Record<string, string> = {
  "mcp.notion.com": "notion",
  "mcp.linear.app": "linear",
  "mcp.atlassian.com": "atlassian",
  "mcp.sentry.dev": "sentry",
  "mcp.honeycomb.io": "honeycomb",
  "huggingface.co": "hugging-face",
  "mcp.cloudflare.com": "cloudflare",
  "mcp.slack.com": "slack",
  "mcp.stripe.com": "stripe",
  "mcp.supabase.com": "supabase",
  "mcp.neon.tech": "neon",
  "mcp.clickhouse.cloud": "clickhouse-cloud",
  "mcp.resend.com": "resend",
  "mcp.airtable.com": "airtable",
  "mcp.box.com": "box",
  "mcp.webflow.com": "webflow",
  "mcp.paypal.com": "paypal",
  "mcp.postman.com": "postman",
  "mcp.zapier.com": "zapier",
  "mcp.alibabacloud.com": "alibaba-cloud",
  "mcp.ai.pulumi.com": "pulumi",
  "mcp.aiven.live": "aiven",
  "mcp.shutterstock.com": "shutterstock",
  "mcp.firecrawl.dev": "firecrawl",
  "mcp.apify.com": "apify",
  "mcp.conversiontools.io": "conversion-tools",
  "mcp.convertapi.io": "convertapi",
};

export function getProxyProviderId(server: McpServerConfig): string | null {
  if (server.authMode !== "oauth") {
    return null;
  }

  try {
    const hostname = new URL(server.url).hostname;
    return PROVIDER_BY_HOSTNAME[hostname] ?? null;
  } catch {
    return null;
  }
}

export async function getOrCreateProxyClientKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(PROXY_CLIENT_KEY_SECURE_KEY);

  if (existing) {
    return existing;
  }

  const generated = Crypto.randomUUID();

  await SecureStore.setItemAsync(PROXY_CLIENT_KEY_SECURE_KEY, generated);

  return generated;
}

async function proxyFetch(
  path: string,
  server: McpServerConfig,
  session: Awaited<ReturnType<typeof secureSecretStore.getMcpOAuthSession>>,
  options?: { method?: "GET" | "POST" },
): Promise<Response> {
  const baseUrl = getMcpOAuthProxyBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "MCP OAuth proxy is not configured. Set EXPO_PUBLIC_MCP_OAUTH_PROXY_URL.",
    );
  }

  const provider = getProxyProviderId(server);

  if (!provider) {
    throw new Error(
      `MCP OAuth proxy does not support the server at ${server.url}.`,
    );
  }

  const proxyToken = session?.proxyToken;

  if (!proxyToken) {
    return new Response(null, { status: 401 });
  }

  const clientKey = await getOrCreateProxyClientKey();

  const url = new URL(path, baseUrl);
  url.searchParams.set("provider", provider);

  return fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      "x-client-key": clientKey,
      Authorization: `Bearer ${proxyToken}`,
      Accept: "application/json",
    },
  });
}

function toOAuthTokens(body: Record<string, unknown>): OAuthTokens | null {
  if (typeof body.access_token !== "string") {
    return null;
  }

  return {
    access_token: body.access_token,
    token_type: typeof body.token_type === "string" ? body.token_type : "Bearer",
    expires_in: typeof body.expires_in === "number" ? body.expires_in : undefined,
    refresh_token:
      typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    scope: typeof body.scope === "string" ? body.scope : undefined,
    authorization_server:
      typeof body.authorization_server === "string"
        ? body.authorization_server
        : undefined,
    token_endpoint:
      typeof body.token_endpoint === "string" ? body.token_endpoint : undefined,
  };
}

export async function fetchProxyTokens(
  server: McpServerConfig,
): Promise<OAuthTokens | null> {
  const session = await secureSecretStore.getMcpOAuthSession(server.id);
  const response = await proxyFetch("/oauth/token", server, session);

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `MCP OAuth proxy token fetch failed (${response.status}).`,
    );
  }

  const body = (await response.json()) as Record<string, unknown>;

  return toOAuthTokens(body);
}

export async function refreshProxyTokens(
  server: McpServerConfig,
): Promise<OAuthTokens | null> {
  const session = await secureSecretStore.getMcpOAuthSession(server.id);
  const response = await proxyFetch("/oauth/refresh", server, session, {
    method: "POST",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`MCP OAuth proxy refresh failed (${response.status}).`);
  }

  const body = (await response.json()) as Record<string, unknown>;

  return toOAuthTokens(body);
}

export async function revokeProxySession(
  server: McpServerConfig,
): Promise<void> {
  const session = await secureSecretStore.getMcpOAuthSession(server.id);
  const response = await proxyFetch("/oauth/revoke", server, session, {
    method: "POST",
  });

  if (!response.ok && response.status !== 401) {
    throw new Error(`MCP OAuth proxy revoke failed (${response.status}).`);
  }
}

export async function beginProxyAuthorization(
  server: McpServerConfig,
): Promise<string> {
  const baseUrl = getMcpOAuthProxyBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "MCP OAuth proxy is not configured. Set EXPO_PUBLIC_MCP_OAUTH_PROXY_URL.",
    );
  }

  const provider = getProxyProviderId(server);

  if (!provider) {
    throw new Error(
      `MCP OAuth proxy does not support the server at ${server.url}.`,
    );
  }

  const clientKey = await getOrCreateProxyClientKey();
  const url = new URL("/oauth/begin", baseUrl);
  url.searchParams.set("provider", provider);
  url.searchParams.set("server", server.id);

  const response = await fetch(url, {
    headers: {
      "x-client-key": clientKey,
      Accept: "application/json",
    },
  });

  const body = (await response.json()) as {
    ticket?: string;
    authorizeUrl?: string;
    error_description?: string;
  };

  if (!response.ok || typeof body.authorizeUrl !== "string") {
    throw new Error(
      body.error_description ?? `Failed to start MCP OAuth (${response.status}).`,
    );
  }

  return body.authorizeUrl;
}

export async function setProxyOAuthSession(
  serverId: string,
  proxyToken: string,
): Promise<void> {
  const session = (await secureSecretStore.getMcpOAuthSession(serverId)) ?? {};

  await secureSecretStore.setMcpOAuthSession(serverId, {
    ...session,
    flowType: "proxy",
    proxyToken,
    expiresAt: null,
    tokens: null,
  });
}