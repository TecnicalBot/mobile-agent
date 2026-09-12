const SECRET_GET_RE =
  /\bapi\.secrets\.get\(\s*(["'])([^"']+)\1\s*\)/g;

/**
 * Extracts the literal secret keys a plugin references via
 * `api.secrets.get("KEY")` so the UI can prompt for them. Keys that are
 * constructed dynamically (e.g. `api.secrets.get("PREFIX_" + x)`) cannot be
 * discovered and should be configured manually via the custom-key UI.
 */
export function extractRequiredSecretKeys(source: string): string[] {
  const keys: string[] = [];

  for (const match of source.matchAll(SECRET_GET_RE)) {
    const key = match[2].trim();
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}