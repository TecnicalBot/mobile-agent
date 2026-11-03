import type { ToolExecutionRecord } from "@/core/types/app-state";

const RESOURCE_TOOLS = new Set([
  "read", "write", "edit", "createFile", "viewFile", "updateDocument", "skill", "skillReadFile",
]);

export function hasLegacyToolResource(record: ToolExecutionRecord) {
  if (
    record.preview ||
    record.diff ||
    record.status !== "completed" ||
    !RESOURCE_TOOLS.has(record.toolName)
  ) {
    return false;
  }
  // A remote harness can use the same tool name (`read`, `edit`, ...) without
  // referring to a local workspace file. Only fall back to the lazy workspace
  // reader when this record actually names a local resource.
  const reference = readToolResourceReference(record);
  return Boolean(reference.fileId || reference.displayName || reference.skillName);
}

/** Old summaries can end halfway through JSON. Recover only complete string fields. */
export function readToolResourceReference(record: ToolExecutionRecord) {
  const field = (source: string | null, name: string): string | undefined => {
    if (!source) return undefined;
    const match = source.match(new RegExp(`"${name}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
    if (!match) return undefined;
    try { return JSON.parse(match[1]) as string; } catch { return undefined; }
  };
  const get = (name: string) => field(record.outputSummary, name) ?? field(record.inputSummary, name);
  return {
    fileId: get("fileId"),
    displayName: get("displayName"),
    skillName: get("name") ?? get("title"),
    path: get("path"),
  };
}
