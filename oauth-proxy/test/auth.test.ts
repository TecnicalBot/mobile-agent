import { describe, expect, it } from "vitest";

import {
  CLIENT_KEY_HEADER,
  clientKeyIdentityResolver,
  resolveIdentity,
  createIdentityContext,
  buildSubjectFromKey,
} from "../src/auth";
import type { OAuthProxyEnv } from "../src/config";

function makeEnv(overrides: Partial<OAuthProxyEnv> = {}): OAuthProxyEnv {
  return {
    PROXY_KV: {} as OAuthProxyEnv["PROXY_KV"],
    CLIENT_KEYS: "key-a,key-b",
    PROVIDER_SECRETS: "{}",
    BASE_URL: "http://worker.test",
    APP_DEEP_LINK: "mobile-agent://app.home/mcp/oauth/callback",
    ...overrides,
  };
}

describe("client-key identity resolver", () => {
  it("resolves identity for an allowed key", async () => {
    const env = makeEnv();
    const request = new Request("http://worker.test/oauth/token", {
      headers: { [CLIENT_KEY_HEADER]: "key-a" },
    });

    const identity = await resolveIdentity(createIdentityContext(env), request);

    expect(identity).not.toBeNull();
    expect(identity!.subject).toMatch(/^install:/);
  });

  it("returns null for an unknown key", async () => {
    const env = makeEnv();
    const request = new Request("http://worker.test/oauth/token", {
      headers: { [CLIENT_KEY_HEADER]: "not-allowed" },
    });

    const identity = await resolveIdentity(createIdentityContext(env), request);

    expect(identity).toBeNull();
  });

  it("returns null when the header is missing", async () => {
    const env = makeEnv();
    const request = new Request("http://worker.test/oauth/token");

    const identity = await resolveIdentity(createIdentityContext(env), request);

    expect(identity).toBeNull();
  });

  it("skips empty keys in the allowed list", () => {
    expect(clientKeyIdentityResolver.name).toBe("client-key");
  });

  it("derives the same stable subject for the same key", async () => {
    const first = await buildSubjectFromKey("key-a");
    const second = await buildSubjectFromKey("key-a");
    const other = await buildSubjectFromKey("key-b");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});