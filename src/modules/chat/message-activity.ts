import type { AgentRunStatus, StoredMessage } from "@/core/types/app-state";
import { buildAssistantParts } from "./assistant-parts";

export type MessageActivity =
  | { kind: "idle" | "tools" | "answering" }
  | { kind: "reasoning"; reasoningId: string }
  | { kind: "waiting"; label: string };

/** Streaming means the turn is unfinished, not that the model is reasoning. */
export function getMessageActivity(
  message: StoredMessage,
  runStatus?: AgentRunStatus | null,
): MessageActivity {
  if (message.role !== "assistant" || message.status !== "streaming") {
    return { kind: "idle" };
  }
  if (runStatus === "waiting_for_approval") {
    return { kind: "waiting", label: "Waiting for approval" };
  }
  if (runStatus === "waiting_for_question") {
    return { kind: "waiting", label: "Waiting for your response" };
  }
  if (runStatus === "queued" || runStatus === "resumable") {
    return { kind: "waiting", label: runStatus === "queued" ? "Queued" : "Waiting to resume" };
  }
  if (runStatus === "retrying") {
    return { kind: "waiting", label: "Retrying…" };
  }
  if (message.metadata?.toolExecutions?.some((tool) => tool.status === "running")) {
    return { kind: "tools" };
  }

  const lastPart = buildAssistantParts(message.content, message.metadata).at(-1);
  if (lastPart?.kind === "reasoning" && lastPart.block.completedAt === null) {
    return { kind: "reasoning", reasoningId: lastPart.block.id };
  }
  if (lastPart?.kind === "text" && lastPart.text.trim()) {
    // Trailing text alone is not proof the model is still talking: a step can
    // finish and the run can keep going (next step, tool input, compaction).
    // Only hide the loader while the writer confirms text is arriving.
    return message.metadata?.streamingText === false
      ? { kind: "waiting", label: "Waiting for response…" }
      : { kind: "answering" };
  }
  return { kind: "waiting", label: "Waiting for response…" };
}
