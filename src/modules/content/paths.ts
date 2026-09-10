/**
 * Pure path/file-name sanitizers for the entity filesystem layout.
 * Kept free of native imports so they can be unit-tested in isolation.
 */

/**
 * Sanitizes a relative supporting-file path so it can safely be placed under
 * the entity directory. Rejects absolute paths, scheme URLs, empty segments,
 * "." and ".." traversal and control characters. Returns the normalized path
 * or null when the input is not a safe relative path.
 */
export function sanitizeRelPath(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(trimmed)) {
    return null;
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  const safe = segments.every(
    (segment) =>
      segment !== "." &&
      segment !== ".." &&
      !/[\u0000-\u001f\u007f]/.test(segment),
  );

  if (!safe) {
    return null;
  }

  return segments.join("/");
}

/**
 * Produces a filesystem-safe file name for an agent doc while preserving the
 * original display name elsewhere. Falls back to "doc" for empty/suspicious
 * input.
 */
export function sanitizeFileName(raw: string): string {
  const sanitized = raw
    .trim()
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .replace(/^\.+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "doc";
}