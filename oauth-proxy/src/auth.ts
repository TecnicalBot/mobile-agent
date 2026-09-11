import type { OAuthProxyEnv } from "./config";
import { sha256Hex } from "./crypto";

/**
 * Identity represents "who" a set of stored provider tokens belongs to.
 *
 * Today the app is a personal, single-user, on-device product, so identity is
 * derived from a per-install client key. This is intentionally structured as a
 * seam: swapping in Clerk/Auth0/JWT later only means adding a new resolver and
 * keeping `subject` stable, without touching the storage or OAuth flow code.
 */
export type Identity = {
  subject: string;
  installId: string;
};

export type IdentityResolver = {
  name: string;
  resolve(
    env: OAuthProxyEnv,
    request: Request,
  ): Promise<Identity | null> | Identity | null;
};

export const CLIENT_KEY_HEADER = "x-client-key";

/**
 * Validates the per-install client key and derives a stable subject from it.
 * The raw key never becomes a storage key; only its SHA-256 is used.
 */
export const clientKeyIdentityResolver: IdentityResolver = {
  name: "client-key",
  resolve(env, request) {
    const installKey = request.headers.get(CLIENT_KEY_HEADER)?.trim();

    if (!installKey) {
      return null;
    }

    const allowed = new Set(
      env.CLIENT_KEYS.split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    );

    if (!allowed.has(installKey)) {
      return null;
    }

    return {
      subject: `install:${installKey.length}-${installKey}`,
      installId: `install:${installKey.length}-${installKey}`,
    };
  },
};

export const defaultIdentityResolver: IdentityResolver = {
  name: "default",
  async resolve(env, request) {
    return clientKeyIdentityResolver.resolve(env, request);
  },
};

export type IdentityContext = {
  env: OAuthProxyEnv;
  resolver: IdentityResolver;
};

export function createIdentityContext(
  env: OAuthProxyEnv,
  resolver: IdentityResolver = defaultIdentityResolver,
): IdentityContext {
  return { env, resolver };
}

export async function resolveIdentity(
  ctx: IdentityContext,
  request: Request,
): Promise<Identity | null> {
  return ctx.resolver.resolve(ctx.env, request);
}

export async function buildSubjectFromKey(installKey: string): Promise<string> {
  return `install:${(await sha256Hex(installKey)).slice(0, 24)}`;
}