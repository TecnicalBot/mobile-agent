import { Hono } from "hono";

import { createIdentityContext, resolveIdentity } from "./auth";
import type { OAuthProxyEnv } from "./config";
import {
  handleAuthorizeRequest,
  handleBeginRequest,
  handleCallbackRequest,
  handleHealthRequest,
  handleRefreshRequest,
  handleRevokeRequest,
  handleTokenRequest,
} from "./oauth";
import { listProviderIds } from "./providers";

type AppEnv = { Bindings: OAuthProxyEnv };

const app = new Hono<AppEnv>();

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "mobile-agent-oauth-proxy",
    docs: {
      health: "GET /health",
      begin: "GET /oauth/begin?provider=<id>&server=<serverId> (x-client-key)",
      authorize: "GET /oauth/authorize?ticket=<short-lived>",
      callback: "GET /oauth/callback/:provider",
      token: "GET /oauth/token (Bearer <proxyToken>)",
      refresh: "POST /oauth/refresh (Bearer <proxyToken>)",
      revoke: "POST /oauth/revoke (Bearer <proxyToken>)",
    },
    providers: listProviderIds(),
  }),
);

app.get("/health", (c) => handleHealthRequest(c.env));

app.get("/oauth/begin", async (c) => {
  const ctx = createIdentityContext(c.env);
  const identity = await resolveIdentity(ctx, c.req.raw);

  if (!identity) {
    return c.json(
      { error: "unauthorized", error_description: "A valid x-client-key header is required." },
      { status: 401 },
    );
  }

  return handleBeginRequest(c.env, identity, c.req.raw);
});

app.get("/oauth/authorize", (c) => handleAuthorizeRequest(c.env, c.req.raw));

app.get("/oauth/callback/:provider", (c) =>
  handleCallbackRequest(c.env, c.req.raw, c.req.param("provider")),
);

app.get("/oauth/token", async (c) => {
  const ctx = createIdentityContext(c.env);
  const identity = await resolveIdentity(ctx, c.req.raw);

  if (!identity) {
    return c.json(
      { error: "unauthorized", error_description: "A valid x-client-key header is required." },
      { status: 401 },
    );
  }

  return handleTokenRequest(c.env, identity, c.req.raw);
});

app.post("/oauth/refresh", async (c) => {
  const ctx = createIdentityContext(c.env);
  const identity = await resolveIdentity(ctx, c.req.raw);

  if (!identity) {
    return c.json(
      { error: "unauthorized", error_description: "A valid x-client-key header is required." },
      { status: 401 },
    );
  }

  return handleRefreshRequest(c.env, identity, c.req.raw);
});

app.post("/oauth/revoke", async (c) => {
  const ctx = createIdentityContext(c.env);
  const identity = await resolveIdentity(ctx, c.req.raw);

  if (!identity) {
    return c.json(
      { error: "unauthorized", error_description: "A valid x-client-key header is required." },
      { status: 401 },
    );
  }

  return handleRevokeRequest(c.env, identity, c.req.raw);
});

export default app;