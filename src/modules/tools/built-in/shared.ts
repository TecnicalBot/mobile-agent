import type { ToolExecutionRecord } from "@/core/types/app-state";

export function summarizeValue(value: unknown) {
  const serialized =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, null, 2) ?? String(value));

  return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
}

/**
 * Preview text is persisted with every tool record (message metadata), so it
 * is bounded like the other captured content in the chat renderer.
 */
export { TOOL_PREVIEW_TEXT_LIMIT } from "@/modules/tools/tool-preview";

/** Structured tool results are capped before being persisted in message metadata. */
export const TOOL_OUTPUT_DATA_LIMIT = 20_000;

function boundOutputData(value: unknown): unknown | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value).length <= TOOL_OUTPUT_DATA_LIMIT
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function createRecord(input: {
  announcement?: ToolExecutionRecord["announcement"];
  mediaResult?: ToolExecutionRecord["mediaResult"];
  preview?: ToolExecutionRecord["preview"];
  subagent?: ToolExecutionRecord["subagent"];
  id?: string;
  /** Optional captured line-diff (added/removed hunks), e.g. for the edit tool. */
  diff?: string | null;
  /** Row stat for the captured diff, like `+48 −12`. */
  diffStat?: string | null;
  error?: string | null;
  inputSummary: string;
  outputSummary?: string | null;
  /** Full structured result for the tool-specific trace card. */
  outputData?: unknown;
  status: ToolExecutionRecord["status"];
  toolName: string;
  termux?: ToolExecutionRecord["termux"];
}) {
  const outputData = boundOutputData(input.outputData);

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
    ...(outputData !== undefined ? { outputData } : {}),
    ...(input.subagent ? { subagent: input.subagent } : {}),
    ...(input.mediaResult ? { mediaResult: input.mediaResult } : {}),
    ...(input.announcement ? { announcement: input.announcement } : {}),
  } satisfies ToolExecutionRecord;
}
