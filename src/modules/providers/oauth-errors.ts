/**
 * Raised when the OAuth server rejects a refresh token. `invalid_grant` and
 * `invalid_token` are terminal: the stored credential can never be refreshed
 * again, so callers must stop retrying and ask the user to reconnect.
 */
export class OAuthSessionExpiredError extends Error {
  readonly code: "invalid_grant" | "invalid_token";

  constructor(message: string, code: "invalid_grant" | "invalid_token") {
    super(message);
    this.name = "OAuthSessionExpiredError";
    this.code = code;
  }
}

export function oauthErrorCode(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

export function isTerminalOAuthErrorCode(
  value: unknown,
): value is "invalid_grant" | "invalid_token" {
  const code = oauthErrorCode(value);

  return code === "invalid_grant" || code === "invalid_token";
}

export function isOAuthSessionExpiredError(
  error: unknown,
): error is OAuthSessionExpiredError {
  return error instanceof OAuthSessionExpiredError;
}
