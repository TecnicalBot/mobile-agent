const READ_ONLY_VERBS = new Set([
  "get",
  "list",
  "search",
  "read",
  "query",
  "find",
  "fetch",
  "peek",
  "inspect",
  "describe",
  "browse",
  "crawl",
  "scrape",
  "summarize",
  "stat",
  "show",
  "lookup",
  "check",
  "view",
  "explore",
  "info",
  "count",
]);

const MUTATING_VERBS = new Set([
  "create",
  "write",
  "edit",
  "update",
  "delete",
  "remove",
  "move",
  "rename",
  "copy",
  "add",
  "set",
  "put",
  "patch",
  "send",
  "submit",
  "post",
  "commit",
  "push",
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
  "run",
  "execute",
  "build",
  "deploy",
  "publish",
  "upload",
  "download",
  "like",
  "follow",
  "block",
]);

export function isMcpToolReadOnly(input: {
  name: string;
  annotations?: Record<string, unknown> | null;
}): boolean {
  const annotations = input.annotations;

  if (annotations && typeof annotations === "object") {
    if (annotations.readOnlyHint === true) return true;
    if (annotations.destructiveHint === true) return false;
  }

  const tokens = input.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (tokens.some((token) => MUTATING_VERBS.has(token))) return false;
  if (tokens.some((token) => READ_ONLY_VERBS.has(token))) return true;

  return false;
}
