import type { ToolExecutionRecord } from "@/core/types/app-state";

export function summarizeValue(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
}

export function createRecord(input: {
  error?: string | null;
  inputSummary: string;
  outputSummary?: string | null;
  status: ToolExecutionRecord["status"];
  toolName: string;
}) {
  return {
    toolName: input.toolName,
    status: input.status,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary ?? null,
    error: input.error ?? null,
    createdAt: new Date().toISOString(),
  } satisfies ToolExecutionRecord;
}
