import { describe, expect, it } from "vitest";

import { parseProviderSecrets, type OAuthProxyEnv } from "../src/config";
import {
  getCallbackUrl,
  getProviderConfig,
  listProviderIds,
  resolveProvider,
} from "../src/providers";

function makeEnv(overrides: Partial<OAuthProxyEnv> = {}): OAuthProxyEnv {
  return {
    PROXY_KV: {} as OAuthProxyEnv["PROXY_KV"],
    CLIENT_KEYS: "key-a",
    PROVIDER_SECRETS: "{}",
    BASE_URL: "http://worker.test",
    APP_DEEP_LINK: "mobile-agent://app.home/mcp/oauth/callback",
    ...overrides,
  };
}

describe("provider registry", () => {
  it("covers every OAuth catalog provider", () => {
    const catalogIds = [
      "notion",
      "linear",
      "atlassian",
      "sentry",
      "honeycomb",
      "hugging-face",
      "cloudflare",
      "slack",
      "stripe",
      "supabase",
      "neon",
      "clickhouse-cloud",
      "resend",
      "airtable",
      "box",
      "webflow",
      "paypal",
      "postman",
      "zapier",
      "alibaba-cloud",
      "pulumi",
      "aiven",
      "shutterstock",
      "firecrawl",
      "apify",
      "conversion-tools",
    ];

    for (const id of catalogIds) {
      expect(getProviderConfig(id), id).not.toBeNull();
    }
  });

  it("defaults to dynamic mode without static credentials", () => {
    const provider = resolveProvider(makeEnv(), "notion");

    expect(provider).not.toBeNull();
    expect(provider!.mode).toBe("dynamic");
    expect(provider!.mcpUrl).toBe("https://mcp.notion.com/mcp");
  });

  it("uses static mode when credentials are configured", () => {
    const env = makeEnv({
      PROVIDER_SECRETS: JSON.stringify({
        notion: { clientId: "cid", clientSecret: "csec" },
      }),
    });

    const provider = resolveProvider(env, "notion");

    expect(provider!.mode).toBe("static");
    expect(provider!.clientId).toBe("cid");
    expect(provider!.clientSecret).toBe("csec");
  });

  it("returns null for unknown providers", () => {
    expect(resolveProvider(makeEnv(), "does-not-exist")).toBeNull();
  });

  it("builds per-provider callback urls", () => {
    expect(getCallbackUrl(makeEnv(), "notion")).toBe(
      "http://worker.test/oauth/callback/notion",
    );
  });

  it("exposes the full provider list", () => {
    expect(listProviderIds()).toContain("notion");
    expect(listProviderIds().length).toBeGreaterThanOrEqual(26);
  });
});

describe("parseProviderSecrets", () => {
  it("parses valid JSON", () => {
    expect(
      parseProviderSecrets('{"slack":{"clientId":"s"}}'),
    ).toEqual({ slack: { clientId: "s" } });
  });

  it("returns empty for invalid or empty input", () => {
    expect(parseProviderSecrets(undefined)).toEqual({});
    expect(parseProviderSecrets("")).toEqual({});
    expect(parseProviderSecrets("not json")).toEqual({});
    expect(parseProviderSecrets("42")).toEqual({});
  });
});