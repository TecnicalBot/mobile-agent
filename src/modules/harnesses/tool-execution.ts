import type { ToolExecutionRecord } from "@/core/types/app-state";
import {
  buildToolPreview,
  type ToolPreviewContentPart,
} from "@/modules/tools/tool-preview";

export type HarnessToolExecutionInput = {
  id?: string;
  toolName: string;
  status: ToolExecutionRecord["status"];
  traceOrder?: number;
  input?: unknown;
  content?: readonly ToolPreviewContentPart[] | null;
  error?: string | null;
  createdAt: string;
  /** Only set for harnesses whose `file://` content lives on this phone. */
  allowFileImages?: boolean;
};

/**
 * Normalize a remote tool call into the same trace record the direct runtime
 * persists. Harness adapters only map their protocol into this shape; titles,
 * truncation, text previews, and safe image handling stay shared.
 */
export function presentHarnessToolExecution(
  input: HarnessToolExecutionInput,
): ToolExecutionRecord {
  const content = input.content ?? [];
  return {
    ...(input.id ? { id: input.id } : {}),
    toolName: input.toolName,
    ...(input.traceOrder !== undefined ? { traceOrder: input.traceOrder } : {}),
    status: input.status,
    inputSummary: input.input === undefined ? "" : JSON.stringify(input.input),
    outputSummary:
      input.content === undefined || input.content === null
        ? null
        : content
            .map((item) =>
              item.type === "text"
                ? item.text
                : `[file] ${item.name?.trim() || item.mime}`,
            )
            .join("\n"),
    error: input.error ?? null,
    createdAt: input.createdAt,
    preview: buildToolPreview({
      fallbackTitle: input.toolName,
      input: input.input,
      content,
      allowFileImages: input.allowFileImages,
    }),
  };
}
