import type { WorkspaceFile } from "../../core/types/app-state";

/** Resolve local markdown links by exact path/ID, then by an unambiguous name. */
export function workspaceFileFromUrl(href: string, files: WorkspaceFile[] | null | undefined): WorkspaceFile | null {
  if (!files?.length || /^(https?|mailto|tel):/i.test(href.trim())) return null;
  let path = href.trim().split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { /* Keep malformed escapes readable. */ }
  path = path.replace(/\\/g, "/");
  const target = path.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").replace(/^\.\//, "");
  const exact = files.filter((file) =>
    target === file.id || target === file.relativePath ||
    target.endsWith(`/${file.relativePath}`));
  if (exact.length === 1) return exact[0];
  const name = target.split("/").filter(Boolean).pop()?.toLowerCase();
  if (!name) return null;
  const matches = files.filter((file) =>
    file.id.toLowerCase() === name || file.displayName.toLowerCase() === name ||
    file.relativePath.split("/").pop()?.toLowerCase() === name);
  return matches.length === 1 ? matches[0] : null;
}
