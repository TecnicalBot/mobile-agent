import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import app from "../src/index";
import type { OAuthProxyEnv } from "../src/config";
import { MemoryKV } from "./memory-kv";
import { putSession } from "../src/kv";

function makeEnv(kv: MemoryKV, overrides: Partial<OAuthProxyEnv> = {}): OAuthProxyEnv {
  return {
    PROXY_KV: kv as unknown as OAuthProxyEnv["PROXY_KV"],
    CLIENT_KEYS: "install-key-a",
    PROVIDER_SECRETS: "{}",
    BASE_URL: "http://worker.test",
    APP_DEEP_LINK: "mobile-agent://app.home/mcp/oauth/callback",
    ...overrides,
  };
}

type FetchRoute = (url: URL, init: RequestInit) => Response | undefined;

function installFetchRouter(routes: FetchRoute[]) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      for (const route of routes) {
        const result = route(url, init ?? {});
        if (result) {
          return result;
        }
      }

      return Response.json(
        { error: "unexpected fetch", url: url.href },
        { status: 500 },
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("OAuth proxy flow (end to end)", () => {
  let kv: MemoryKV;
  let tokenCalls: URLSearchParams[] = [];
  let registrationBodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    kv = new MemoryKV();
    tokenCalls = [];
    registrationBodies = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("authorizes a user, exchanges the code, serves and refreshes tokens, revokes", async () => {
    installFetchRouter([
      (url) => {
        if (url.href === "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp") {
          return jsonResponse({
            authorization_servers: ["https://auth.notion.com"],
            resource: "https://mcp-resource.notion.com/v1",
            scopes_supported: ["read_items", "read_databases"],
          });
        }
        return undefined;
      },
      (url) => {
        if (url.href === "https://auth.notion.com/.well-known/oauth-authorization-server") {
          return jsonResponse({
            issuer: "https://auth.notion.com",
            authorization_endpoint: "https://auth.notion.com/authorize",
            token_endpoint: "https://auth.notion.com/token",
            registration_endpoint: "https://auth.notion.com/register",
          });
        }
        return undefined;
      },
      (url, init) => {
        if (url.href === "https://auth.notion.com/register") {
          expect(init.method).toBe("POST");
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          registrationBodies.push(body);
          expect(body.redirect_uris).toEqual([
            "http://worker.test/oauth/callback/notion",
          ]);
          return jsonResponse({ client_id: "dyn-client", client_secret: "dyn-secret" });
        }
        return undefined;
      },
      (url, init) => {
        if (url.href === "https://auth.notion.com/token") {
          const body = new URLSearchParams(String(init.body));
          tokenCalls.push(body);
          if (body.get("grant_type") === "authorization_code") {
            expect(body.get("client_id")).toBe("dyn-client");
            expect(body.get("client_secret")).toBe("dyn-secret");
            expect(body.get("code_verifier")).toBeTruthy();
            expect(body.get("redirect_uri")).toBe(
              "http://worker.test/oauth/callback/notion",
            );
            return jsonResponse({
              access_token: "at-code",
              refresh_token: "rt-1",
              token_type: "Bearer",
              expires_in: 3600,
              scope: "read_items read_databases",
            });
          }
          if (body.get("grant_type") === "refresh_token") {
            expect(body.get("refresh_token")).toBe("rt-1");
            return jsonResponse({
              access_token: "at-refresh",
              refresh_token: "rt-2",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }
          return jsonResponse({ error: "unsupported_grant_type" }, 400);
        }
        return undefined;
      },
    ]);

    const env = makeEnv(kv);

    // 1. Unauthorized without a client key.
    const unauthorized = await app.request(
      "/oauth/begin?provider=notion",
      {},
      env,
    );
    expect(unauthorized.status).toBe(401);

    // 2. Begin (authenticated) issues a one-time ticket.
    const begin = await app.request(
      "/oauth/begin?provider=notion&server=srv-1",
      { headers: { "x-client-key": "install-key-a" } },
      env,
    );
    expect(begin.status).toBe(200);
    const { ticket, authorizeUrl } = (await begin.json()) as {
      ticket: string;
      authorizeUrl: string;
    };
    expect(ticket).toBeTruthy();
    expect(authorizeUrl).toContain(`ticket=${ticket}`);

    // 3. The browser follows the ticket-based authorize link.
    const authorize = await app.request(authorizeUrl, {}, env);
    expect(authorize.status).toBe(302);
    const authorizationUrl = new URL(authorize.headers.get("location")!);

    expect(authorizationUrl.origin).toBe("https://auth.notion.com");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("dyn-client");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "http://worker.test/oauth/callback/notion",
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("scope")).toContain("read_items");
    const state = authorizationUrl.searchParams.get("state")!;
    expect(state).toBeTruthy();

    // 4. Provider redirects to the callback.
    const callback = await app.request(
      `/oauth/callback/notion?state=${state}&code=abc123`,
      {},
      env,
    );
    expect(callback.status).toBe(302);
    const deepLink = new URL(callback.headers.get("location")!);
    expect(deepLink.protocol).toBe("mobile-agent:");
    expect(deepLink.searchParams.get("provider")).toBe("notion");
    expect(deepLink.searchParams.get("server")).toBe("srv-1");
    const proxy = deepLink.searchParams.get("proxy")!;
    expect(proxy).toBeTruthy();

    // 5. Token endpoint serves the stored access token.
    const token = await app.request(
      `/oauth/token?provider=notion`,
      {
        headers: {
          "x-client-key": "install-key-a",
          Authorization: `Bearer ${proxy}`,
        },
      },
      env,
    );
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as Record<string, string>;
    expect(tokenBody.access_token).toBe("at-code");
    expect(tokenBody.refresh_token).toBe("rt-1");
    expect(tokenBody.authorization_server).toBe("https://auth.notion.com");

    // 6. Refresh rotates the tokens.
    const refresh = await app.request(
      `/oauth/refresh?provider=notion`,
      {
        method: "POST",
        headers: {
          "x-client-key": "install-key-a",
          Authorization: `Bearer ${proxy}`,
        },
      },
      env,
    );
    expect(refresh.status).toBe(200);
    const refreshBody = (await refresh.json()) as Record<string, string>;
    expect(refreshBody.access_token).toBe("at-refresh");
    expect(refreshBody.refresh_token).toBe("rt-2");

    // 7. Token now returns the refreshed access token.
    const tokenAfter = await app.request(
      `/oauth/token?provider=notion`,
      {
        headers: {
          "x-client-key": "install-key-a",
          Authorization: `Bearer ${proxy}`,
        },
      },
      env,
    );
    expect((await tokenAfter.json()) as { access_token: string }).toMatchObject({
      access_token: "at-refresh",
    });

    // 7. Revoke clears the session; token is gone.
    await app.request(
      `/oauth/revoke?provider=notion`,
      {
        method: "POST",
        headers: {
          "x-client-key": "install-key-a",
          Authorization: `Bearer ${proxy}`,
        },
      },
      env,
    );
    const revoked = await app.request(
      `/oauth/token?provider=notion`,
      {
        headers: {
          "x-client-key": "install-key-a",
          Authorization: `Bearer ${proxy}`,
        },
      },
      env,
    );
    expect(revoked.status).toBe(401);
  });

  it("rejects a callback with a stale state", async () => {
    const env = makeEnv(kv);
    installFetchRouter([]);

    const callback = await app.request(
      "/oauth/callback/notion?state=stale&code=abc123",
      {},
      env,
    );

    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("expired or already been used");
  });

  it("auto-refreshes an expired session during a token request", async () => {
    let grantCalls = 0;

    installFetchRouter([
      (url, init) => {
        if (url.href === "https://auth.notion.com/token") {
          const body = new URLSearchParams(String(init.body));
          expect(body.get("grant_type")).toBe("refresh_token");
          expect(body.get("refresh_token")).toBe("rt-expired");
          grantCalls += 1;
          return jsonResponse({
            access_token: "at-fresh",
            refresh_token: "rt-fresh",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        return undefined;
      },
    ]);

    const env = makeEnv(kv);
    await putSession(
      env.PROXY_KV,
      "fixed-proxy",
      {
        subject: "install:13-install-key-a",
        provider: "notion",
        server: "srv-1",
        flowType: "proxy",
        authServer: {
          authorizationServerUrl: "https://auth.notion.com",
          tokenEndpoint: "https://auth.notion.com/token",
        },
        clientInfo: { client_id: "c", client_secret: "s" },
        tokens: {
          access_token: "at-expired",
          refresh_token: "rt-expired",
          expires_at: Date.now() - 1000,
          token_type: "Bearer",
        },
      },
      { ttlSeconds: 3600 },
    );

    const token = await app.request(
      "/oauth/token?provider=notion",
      {
        headers: {
          "x-client-key": "install-key-a",
          Authorization: "Bearer fixed-proxy",
        },
      },
      env,
    );

    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; refresh_token: string };
    expect(body.access_token).toBe("at-fresh");
    expect(body.refresh_token).toBe("rt-fresh");
    expect(grantCalls).toBe(1);
  });
});