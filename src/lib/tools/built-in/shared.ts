import type { ToolExecutionRecord, WorkspaceFile } from "@/types/app-state";
import { isTextWorkspaceFile } from "@/lib/workspace/workspace-file-service";

export function summarizeValue(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return serialized.length > 600 ? `${serialized.slice(0, 600)}...` : serialized;
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

export function createFileSelectionPrompt(
  files: WorkspaceFile[],
  selectedFileIds: string[],
) {
  if (files.length === 0) {
    return [
      "Workspace files are available through tools.",
      "The user has not selected any specific files for this turn.",
    ].join("\n");
  }

  const lines = files.map((file) => {
    const markers = [
      selectedFileIds.includes(file.id) ? "selected" : null,
      isTextWorkspaceFile(file) ? "text" : "binary",
    ]
      .filter(Boolean)
      .join(", ");

    return `- ${file.displayName} (id: ${file.id}; ${markers})`;
  });

  return [
    "Workspace files are available through tools.",
    "Use file tools when the user asks to inspect or modify files.",
    "Available files:",
    ...lines,
  ].join("\n");
}
