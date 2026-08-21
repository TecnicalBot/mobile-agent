import type { ModelMessage, ToolSet } from "ai";

import type { ResolvedModel } from "@/core/types/app-state";

export function msg(
  role: "system" | "user" | "assistant",
  content: string,
): ModelMessage {
  return { role, content } as ModelMessage;
}

export function contentMessage(
  role: "system" | "user" | "assistant" | "tool",
  content: unknown,
): ModelMessage {
  return { role, content } as unknown as ModelMessage;
}

export function textPart(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

export function reasoningPart(
  text: string,
): { type: "reasoning"; text: string } {
  return { type: "reasoning", text };
}

export function toolResultPart(
  content: string,
): { type: "tool-result"; content: string } {
  return { type: "tool-result", content };
}

export function toolCallInputPart(
  input: unknown,
): { type: "tool-call"; toolCallId: string; toolName: string; input: unknown } {
  return { type: "tool-call", toolCallId: "call_1", toolName: "read", input };
}

export function toolResultOutputPart(
  output: unknown,
): {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
} {
  return {
    type: "tool-result",
    toolCallId: "call_1",
    toolName: "read",
    output,
  };
}

export function fakeModel(contextWindow?: number | null): ResolvedModel {
  return {
    contextWindow: contextWindow ?? null,
  } as unknown as ResolvedModel;
}

export function emptyTools(): ToolSet {
  return {};
}

export function windowForUsable(usable: number): number {
  const reservedAt = (window: number) =>
    Math.max(256, Math.floor(window * 0.25)) +
    Math.max(128, Math.floor(window * 0.1));
  for (let window = usable + 384; window < 400_000; window++) {
    if (window - reservedAt(window) === usable) return window;
  }
  throw new Error(`No context window found for usable=${usable}`);
}
