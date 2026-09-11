export type OAuthProxyEnv = {
  PROXY_KV: KVNamespace;
  /**
   * Comma-separated list of allowed per-install client keys. The mobile app
   * sends one of these in the `x-client-key` header. This is a lightweight
   * install-level gate, NOT user auth.
   */
  CLIENT_KEYS: string;
  /**
   * JSON object keyed by provider id:
   * `{ "<providerId>": { "clientId": "...", "clientSecret": "..." } }`
   * Providers listed here skip dynamic client registration and use your own
   * registered OAuth app. All other providers use dynamic registration.
   */
  PROVIDER_SECRETS: string;
  /** Public base URL of this worker (used as the OAuth redirect_uri origin). */
  BASE_URL: string;
  /** Deep link the worker redirects to after a successful callback. */
  APP_DEEP_LINK: string;
};

export function parseProviderSecrets(raw: string | undefined): Record<
  string,
  { clientId?: string; clientSecret?: string }
> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<
        string,
        { clientId?: string; clientSecret?: string }
      >;
    }
  } catch {
    // fall through to empty
  }

  return {};
}