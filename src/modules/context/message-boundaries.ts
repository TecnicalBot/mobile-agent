import type { ModelMessage } from "ai";

/** Rewind a retained suffix so results never lose their matching tool calls. */
export function safeTailStart(messages: ModelMessage[], start: number): number {
  const pending = new Set<string>();
  let safeStart = 0;
  for (let i = 0; i <= start && i < messages.length; i++) {
    const message = messages[i]!;
    if (pending.size === 0 && message.role !== "tool") safeStart = i;
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call") pending.add(part.toolCallId);
      if (part.type === "tool-result") pending.delete(part.toolCallId);
    }
  }
  return safeStart;
}
