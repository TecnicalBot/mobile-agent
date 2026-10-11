/**
 * Path helpers shared by the main process and the renderer.
 *
 * The renderer cannot use `node:path` (it runs with `contextIsolation` and no
 * Node integration), so the handful of operations the `expo-file-system` shim
 * needs are implemented here instead. Windows and POSIX separators are both
 * understood, and a path is only treated as Windows-shaped when it carries a
 * drive letter, so the same helpers serve every desktop target.
 */

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * Windows compares paths case-insensitively; Linux and macOS do not.
 *
 * Folding case on a case-sensitive filesystem would let a path that is outside
 * an allowed root compare equal to one inside it (or the reverse), so the
 * behaviour is keyed off the host platform. `typeof process` guards the import
 * in the renderer, where this module is bundled without Node integration and
 * `isInsideRoot` is never called.
 */
const CASE_INSENSITIVE_PATHS =
  typeof process !== "undefined" && process.platform === "win32";

export function isWindowsAbsolute(path: string): boolean {
  return WINDOWS_ABSOLUTE.test(path);
}

function separatorFor(path: string): "/" | "\\" {
  return isWindowsAbsolute(path) ? "\\" : "/";
}

/** Joins path segments, ignoring empty ones. */
export function joinPath(base: string, ...segments: string[]): string {
  const parts = segments.filter((segment) => segment.length > 0);
  let result = base;

  for (const part of parts) {
    result = `${result.replace(/[\\/]+$/, "")}${separatorFor(base)}${part.replace(/^[\\/]+/, "")}`;
  }

  return result;
}

/** The final segment of a path. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);

  return parts[parts.length - 1] ?? "";
}

/** The parent directory of a path. */
export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(
    trimmed.lastIndexOf("\\"),
    trimmed.lastIndexOf("/"),
  );

  if (index < 0) {
    return trimmed;
  }

  // Preserve a bare drive root such as `C:`.
  if (index <= 2) {
    return trimmed.slice(0, index + 1);
  }

  return trimmed.slice(0, index);
}

/**
 * Converts a `file://` URI to a filesystem path, passing plain paths through
 * unchanged.
 *
 * Stored `file_path` columns round-trip through this function, so a value that
 * was written as a URI by one version must still resolve when read back.
 */
export function fromFileUri(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }

  // `file:///C:/x` -> `/C:/x` -> `C:/x`
  const withoutScheme = uri.slice("file://".length);
  const decoded = safeDecode(withoutScheme);
  const withoutLeadingSlash = decoded.replace(/^\/+/, "");

  if (WINDOWS_ABSOLUTE.test(withoutLeadingSlash)) {
    return withoutLeadingSlash.replace(/\//g, "\\");
  }

  // UNC path: `file://server/share` -> `\\server\share`
  if (decoded.startsWith("//")) {
    return `\\\\${decoded.slice(2).replace(/\//g, "\\")}`;
  }

  return decoded;
}

/** Converts a filesystem path to a `file://` URI. */
export function toFileUri(path: string): string {
  if (path.startsWith("file://")) {
    return path;
  }

  const normalised = path.replace(/\\/g, "/");
  const withLeadingSlash = isWindowsAbsolute(normalised)
    ? `/${normalised}`
    : normalised;

  const encoded = withLeadingSlash
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `file://${encoded}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Returns `path` if it is inside `root`, otherwise `null`.
 *
 * The main process uses this to keep renderer-initiated filesystem access
 * inside the app's own data directories, so a compromised renderer cannot read
 * or write arbitrary files.
 */
function normaliseForComparison(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");

  return CASE_INSENSITIVE_PATHS ? trimmed.toLowerCase() : trimmed;
}

export function isInsideRoot(root: string, path: string): boolean {
  const normalisedRoot = normaliseForComparison(root);
  const normalisedPath = normaliseForComparison(path);

  if (normalisedPath === normalisedRoot) {
    return true;
  }

  return normalisedPath.startsWith(`${normalisedRoot}\\`) ||
    normalisedPath.startsWith(`${normalisedRoot}/`);
}
