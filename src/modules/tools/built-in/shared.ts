import type { ToolExecutionRecord } from "@/core/types/app-state";

export function summarizeValue(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
}

/**
 * Preview text is persisted with every tool record (message metadata), so it
 * is bounded like the other captured content in the chat renderer.
 */
export { TOOL_PREVIEW_TEXT_LIMIT } from "@/modules/tools/tool-preview";

export function createRecord(input: {
  announcement?: ToolExecutionRecord["announcement"];
  mediaResult?: ToolExecutionRecord["mediaResult"];
  preview?: ToolExecutionRecord["preview"];
  id?: string;
  /** Optional captured line-diff (added/removed hunks), e.g. for the edit tool. */
  diff?: string | null;
  /** Row stat for the captured diff, like `+48 −12`. */
  diffStat?: string | null;
  error?: string | null;
  inputSummary: string;
  outputSummary?: string | null;
  status: ToolExecutionRecord["status"];
  toolName: string;
  termux?: ToolExecutionRecord["termux"];
}) {
  return {
    ...(input.id ? { id: input.id } : {}),
    toolName: input.toolName,
    status: input.status,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary ?? null,
    error: input.error ?? null,
    createdAt: new Date().toISOString(),
    ...(input.termux ? { termux: input.termux } : {}),
    ...(input.diff ? { diff: input.diff } : {}),
    ...(input.diffStat ? { diffStat: input.diffStat } : {}),
    ...(input.preview ? { preview: input.preview } : {}),
    ...(input.mediaResult ? { mediaResult: input.mediaResult } : {}),
    ...(input.announcement ? { announcement: input.announcement } : {}),
  } satisfies ToolExecutionRecord;
}
