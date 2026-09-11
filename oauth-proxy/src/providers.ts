import { parseProviderSecrets, type OAuthProxyEnv } from "./config";

/**
 * OAuth profile for a provider the proxy can broker. Providers with static
 * credentials (registered OAuth apps) use `mode: "static"`. Everything else
 * falls back to RFC 8414 discovery + dynamic client registration at runtime.
 */
export type ProxyProviderConfig = {
  /** Matches the `id` used in `catalog/mcp-servers.json`. */
  id: string;
  /** MCP server URL used as the discovery/dispatch root. */
  mcpUrl: string;
  /** Default scope string. Empty -> discovered scopes are used. */
  scope?: string;
  /** Override for the authorization endpoint (skips discovery). */
  authorizationUrl?: string;
  /** Override for the token endpoint (skips discovery). */
  tokenUrl?: string;
  /** Expected issuer for the authorization server. */
  issuer?: string;
  /** Extra query params appended to the authorization URL. */
  extraParams?: Record<string, string>;
  /** Send the MCP `resource` param on authorize + token-exchange (compat). */
  useResourceParam?: boolean;
  /** Never use static credentials even if they are configured. */
  forceDynamic?: boolean;
};

export type ProxyProvider = ProxyProviderConfig & {
  mode: "static" | "dynamic";
  clientId?: string;
  clientSecret?: string;
};

export const PROVIDERS: ProxyProviderConfig[] = [
  { id: "notion", mcpUrl: "https://mcp.notion.com/mcp" },
  { id: "linear", mcpUrl: "https://mcp.linear.app/mcp" },
  { id: "atlassian", mcpUrl: "https://mcp.atlassian.com/v1/mcp/authv2" },
  { id: "sentry", mcpUrl: "https://mcp.sentry.dev/mcp" },
  { id: "honeycomb", mcpUrl: "https://mcp.honeycomb.io/mcp" },
  { id: "hugging-face", mcpUrl: "https://huggingface.co/mcp" },
  { id: "cloudflare", mcpUrl: "https://mcp.cloudflare.com/mcp" },
  { id: "slack", mcpUrl: "https://mcp.slack.com/mcp" },
  { id: "stripe", mcpUrl: "https://mcp.stripe.com" },
  { id: "supabase", mcpUrl: "https://mcp.supabase.com/mcp" },
  { id: "neon", mcpUrl: "https://mcp.neon.tech/mcp" },
  { id: "clickhouse-cloud", mcpUrl: "https://mcp.clickhouse.cloud/mcp" },
  { id: "resend", mcpUrl: "https://mcp.resend.com/mcp" },
  { id: "airtable", mcpUrl: "https://mcp.airtable.com/mcp" },
  { id: "box", mcpUrl: "https://mcp.box.com/mcp" },
  { id: "webflow", mcpUrl: "https://mcp.webflow.com/mcp" },
  { id: "paypal", mcpUrl: "https://mcp.paypal.com/mcp" },
  { id: "postman", mcpUrl: "https://mcp.postman.com/mcp" },
  { id: "zapier", mcpUrl: "https://mcp.zapier.com/api/v1/connect", extraParams: { ci: "true" } },
  { id: "alibaba-cloud", mcpUrl: "https://mcp.alibabacloud.com/mcp" },
  { id: "pulumi", mcpUrl: "https://mcp.ai.pulumi.com/mcp" },
  { id: "aiven", mcpUrl: "https://mcp.aiven.live/mcp" },
  { id: "shutterstock", mcpUrl: "https://mcp.shutterstock.com/mcp" },
  { id: "firecrawl", mcpUrl: "https://mcp.firecrawl.dev/v2/mcp-oauth" },
  { id: "apify", mcpUrl: "https://mcp.apify.com" },
  { id: "conversion-tools", mcpUrl: "https://mcp.conversiontools.io/mcp", useResourceParam: true },
  // ConvertAPI uses a non-standard resource-parameter compat flow.
  { id: "convertapi", mcpUrl: "https://mcp.convertapi.io/mcp", useResourceParam: true },
];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getProviderConfig(id: string): ProxyProviderConfig | null {
  return BY_ID.get(id) ?? null;
}

export function listProviderIds(): string[] {
  return PROVIDERS.map((provider) => provider.id);
}

export function getAuthServerOverrides(
  provider: ProxyProviderConfig,
): { authorizationUrl: string; tokenUrl: string; issuer?: string } | null {
  if (provider.authorizationUrl && provider.tokenUrl) {
    return {
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      issuer: provider.issuer,
    };
  }

  return null;
}

export function resolveProvider(
  env: OAuthProxyEnv,
  id: string,
): ProxyProvider | null {
  const config = getProviderConfig(id);

  if (!config) {
    return null;
  }

  const secrets = parseProviderSecrets(env.PROVIDER_SECRETS);

  let credentials: { clientId?: string; clientSecret?: string } =
    secrets[id] ?? {};

  return {
    ...config,
    mode:
      !config.forceDynamic && credentials.clientId
        ? "static"
        : "dynamic",
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  };
}

export function getCallbackUrl(env: OAuthProxyEnv, providerId: string): string {
  return `${env.BASE_URL.replace(/\/$/, "")}/oauth/callback/${encodeURIComponent(providerId)}`;
}