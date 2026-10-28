/** Workspace-relative paths must never resolve into app databases or credential files. */
export function workspacePathSegments(path: string): string[] {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("~") ||
    path.includes("\\") ||
    path.includes(":") ||
    /[\u0000-\u001f]/.test(path)
  ) {
    throw new Error("Use a workspace-relative file path.");
  }
  const segments = path.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some((segment) => segment === "." || segment === "..")
  )
    throw new Error("Workspace traversal is not allowed.");
  return segments;
}
