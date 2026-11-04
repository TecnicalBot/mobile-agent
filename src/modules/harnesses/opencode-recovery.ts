import type {
  SessionMessageInfo,
  SessionStructuredError,
} from "@opencode/client";

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>;

/**
 * Idle and system rows can trail a completed turn. Look past them so a stalled
 * assistant is still detected when the server appends an execution outcome.
 */
export function openCodeLastConversationMessage(
  messages: SessionMessageInfo[],
): SessionMessageInfo | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "user" || message.type === "assistant") return message;
  }
  return null;
}

/**
 * A completed assistant step with reasoning but no visible text or tool call is
 * never a useful answer. OpenCode currently reports it as a successful stop
 * (and the app would otherwise show the previous tool row and then silence).
 */
export function openCodeStalledAssistant(
  messages: SessionMessageInfo[],
): Assistant | null {
  const last = openCodeLastConversationMessage(messages);
  if (!last || last.type !== "assistant") return null;
  if (last.error || !last.time.completed) return null;
  if (
    last.finish &&
    last.finish !== "stop" &&
    last.finish !== "length" &&
    last.finish !== "unknown"
  )
    return null;
  const hasText = last.content.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
  const hasTool = last.content.some((part) => part.type === "tool");
  return hasText || hasTool ? null : last;
}

/**
 * OpenCode reports a failed execution as a trailing idle row, not as an
 * assistant message. Surface the cause instead of leaving the chat silent.
 */
export function openCodeExecutionFailure(
  messages: SessionMessageInfo[],
): SessionStructuredError | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "user" || message.type === "assistant") return null;
    if (message.type !== "idle") continue;
    if (message.outcome !== "failed") return null;
    return (
      message.error ?? {
        type: "ExecutionFailed",
        message: "OpenCode stopped before finishing the response.",
      }
    );
  }
  return null;
}

export type OpenCodePromptReply =
  | { state: "missing" }
  | { state: "waiting" }
  | { state: "answered" }
  | { state: "stalled"; assistant: Assistant };

/**
 * Classify what the remote session did with a prompt. This does not require the
 * app to have observed a running snapshot, so a turn that starts and stops
 * between two polls still gets recovered.
 */
export function openCodePromptReply(
  messages: SessionMessageInfo[],
  prompt: { userID: string; previousMessageID?: string | null },
): OpenCodePromptReply {
  let promptIndex = messages.findIndex(
    (message) => message.id === prompt.userID && message.type === "user",
  );
  if (promptIndex < 0 && prompt.previousMessageID) {
    // The inbox id and the stored user-message id can differ. Anchor on the
    // last row we saw before sending instead.
    const previousIndex = messages.findIndex(
      (message) => message.id === prompt.previousMessageID,
    );
    if (previousIndex >= 0) {
      const nextUser = messages
        .slice(previousIndex + 1)
        .find((message) => message.type === "user");
      if (!nextUser) return { state: "waiting" };
      promptIndex = messages.findIndex(
        (message) => message.id === nextUser.id,
      );
    }
  }
  if (promptIndex < 0) return { state: "missing" };
  const last = openCodeLastConversationMessage(
    messages.slice(promptIndex + 1),
  );
  if (!last || last.type === "user") return { state: "waiting" };
  if (last.type !== "assistant") return { state: "waiting" };
  if (!last.time.completed) return { state: "waiting" };
  if (openCodeStalledAssistant([last])) {
    return { state: "stalled", assistant: last };
  }
  return { state: "answered" };
}

/** Synthetic input is not shown as a user bubble, but resumes the session. */
export const OPENCODE_CONTINUATION_PROMPT =
  "Continue from where you left off. The previous step ended without a response. Call the next tool if one is needed, then give the user a complete final answer. Do not repeat tools whose results are already in the conversation.";
