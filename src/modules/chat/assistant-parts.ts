import type { MessageMetadata, ReasoningBlock, ToolExecutionRecord } from "@/core/types/app-state";

export type AssistantPart =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; block: ReasoningBlock }
  | { kind: "tool"; key: string; record: ToolExecutionRecord };

/** Split text only at recorded stream boundaries; never append legacy tools after the reply. */
export function buildAssistantParts(content: string, metadata?: MessageMetadata | null): AssistantPart[] {
  const offsets = new Map([
    ...(metadata?.termuxRunAnchors ?? []),
    ...(metadata?.toolRunAnchors ?? []),
  ].map((anchor) => [anchor.executionId, anchor.textOffset]));
  const events = [
    ...(metadata?.reasoning ?? [])
      // A completed block with no text is an empty step — not worth a row.
      .filter((block) => !(block.completedAt !== null && block.text.trim() === ""))
      .map((block) => ({
        part: { kind: "reasoning", key: `reasoning-${block.id}`, block } as AssistantPart,
        offset: block.textOffset,
        order: block.traceOrder,
        time: Date.parse(block.startedAt) || 0,
      })),
    ...(metadata?.toolExecutions ?? []).map((record, index) => ({
      part: { kind: "tool", key: `tool-${record.id ?? index}`, record } as AssistantPart,
      offset: record.id ? offsets.get(record.id) : undefined,
      order: record.traceOrder,
      time: Date.parse(record.createdAt) || 0,
    })),
  ].sort((a, b) => a.order !== undefined && b.order !== undefined
    ? a.order - b.order : a.time - b.time);

  const parts: AssistantPart[] = [];
  let cursor = 0;
  for (const event of events) {
    // Older turns have timestamps but no offsets. Keep their activity in
    // chronological order before the answer; do not pretend to know text boundaries.
    const offset = Number.isInteger(event.offset) && event.offset! >= 0 && event.offset! <= content.length
      ? Math.max(cursor, event.offset!) : cursor;
    if (offset > cursor) {
      // Trailing text becomes text before an event when a tool/thought arrives.
      // Keep its identity so images, code blocks and open previews stay mounted.
      parts.push({ kind: "text", key: `text-${cursor}`, text: content.slice(cursor, offset) });
    }
    parts.push(event.part);
    cursor = offset;
  }
  if (cursor < content.length) parts.push({ kind: "text", key: `text-${cursor}`, text: content.slice(cursor) });
  return parts;
}
