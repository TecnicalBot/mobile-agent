import { describe, expect, it, vi, afterEach } from "vitest";

import {
  buildAuthorizationMetadataUrls,
  buildWellKnownPath,
  discoverAuthorizationServerMetadataCompat,
  parseAuthorizationServerMetadata,
  parseProtectedResourceMetadata,
  registerDiscoveryClient,
  resolveProtectedResourceUrl,
} from "../src/discovery";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function installFetch(fetcher: (url: URL, init?: RequestInit) => Response) {
  const mock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL((input as Request).url);
      return fetcher(url, init);
    },
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discovery helpers", () => {
  it("builds well-known paths", () => {
    expect(buildWellKnownPath("oauth-protected-resource", "/mcp")).toBe(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(buildWellKnownPath("oauth-protected-resource", "/")).toBe(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("orders authorization server metadata candidates", () => {
    expect(
      buildAuthorizationMetadataUrls("https://mcp.notion.com/mcp"),
    ).toEqual([
      "/.well-known/oauth-authorization-server/mcp",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration/mcp",
      "/mcp/.well-known/openid-configuration",
    ]);
  });

  it("resolves protected resource urls and validates origins", () => {
    // Same-origin, sub-path of the server path is allowed.
    expect(
      resolveProtectedResourceUrl(
        "https://mcp.notion.com/mcp",
        { resource: "https://mcp.notion.com/mcp/v1" },
      ),
    ).toBe("https://mcp.notion.com/mcp/v1");

    // Cross-origin resources are ignored.
    expect(
      resolveProtectedResourceUrl(
        "https://mcp.notion.com/mcp",
        { resource: "https://evil.example.com/v1" },
      ),
    ).toBe("https://mcp.notion.com/mcp");
  });

  it("parses metadata", () => {
    expect(
      parseProtectedResourceMetadata({
        authorization_servers: ["https://auth.notion.com"],
        resource: "https://resource.notion.com",
        scopes_supported: ["read"],
      }),
    ).toEqual({
      authorization_servers: ["https://auth.notion.com"],
      resource: "https://resource.notion.com",
      scopes_supported: ["read"],
    });

    expect(() => parseProtectedResourceMetadata(null)).toThrow(
      "Invalid OAuth protected resource metadata response.",
    );

    expect(() =>
      parseAuthorizationServerMetadata({ authorization_endpoint: "/authorize" }),
    ).toThrow("metadata is missing endpoints");
  });
});

describe("discoverAuthorizationServerMetadataCompat", () => {
  it("tries candidates in order until one resolves", async () => {
    const mock = installFetch((url) => {
      if (url.pathname === "/.well-known/oauth-authorization-server/mcp") {
        return new Response("", { status: 404 });
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return jsonResponse({
          authorization_endpoint: "https://auth.test/authorize",
          token_endpoint: "https://auth.test/token",
        });
      }
      return new Response("", { status: 404 });
    });

    const metadata = await discoverAuthorizationServerMetadataCompat(
      "https://mcp.test/mcp",
    );

    expect(metadata).toEqual({
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("throws when no candidate works", async () => {
    installFetch(() => new Response("", { status: 404 }));

    await expect(
      discoverAuthorizationServerMetadataCompat("https://mcp.test/mcp"),
    ).rejects.toThrow("could not be discovered");
  });
});

describe("registerDiscoveryClient", () => {
  it("registers with the worker callback as redirect uri", async () => {
    const mock = installFetch((url, init) => {
      expect(url.href).toBe("https://auth.test/register");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        redirect_uris: string[];
      };
      expect(body.redirect_uris).toEqual(["https://proxy.test/oauth/callback/x"]);
      return jsonResponse({ client_id: "c123", client_secret: "s456" });
    });

    const result = await registerDiscoveryClient(
      {
        authorization_endpoint: "https://auth.test/authorize",
        token_endpoint: "https://auth.test/token",
        registration_endpoint: "https://auth.test/register",
        issuer: "https://auth.test",
      },
      {
        client_name: "Mobile Agent",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: ["https://proxy.test/oauth/callback/x"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      "https://proxy.test/oauth/callback/x",
    );

    expect(result).toMatchObject({
      client_id: "c123",
      client_secret: "s456",
      token_endpoint: "https://auth.test/token",
      authorization_server: "https://auth.test",
      redirect_uri: "https://proxy.test/oauth/callback/x",
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("throws when registration responds with an error", async () => {
    installFetch(() =>
      jsonResponse(
        { error: "invalid_redirect_uri", error_description: "nope" },
        400,
      ),
    );

    await expect(
      registerDiscoveryClient(
        {
          authorization_endpoint: "https://auth.test/authorize",
          token_endpoint: "https://auth.test/token",
          registration_endpoint: "https://auth.test/register",
        },
        { redirect_uris: [] },
        "https://proxy.test/oauth/callback/x",
      ),
    ).rejects.toThrow("invalid_redirect_uri nope");
  });

  it("mentions dynamic registration when the endpoint is absent", async () => {
    await expect(
      registerDiscoveryClient(
        {
          authorization_endpoint: "https://auth.test/authorize",
          token_endpoint: "https://auth.test/token",
        },
        {},
        "https://proxy.test/oauth/callback/x",
      ),
    ).rejects.toThrow("does not support dynamic client registration");
  });
});