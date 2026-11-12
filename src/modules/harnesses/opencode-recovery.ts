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
  // A retry in progress is not a stall; OpenCode is still working on the turn.
  if (last.error || last.retry || !last.time.completed) return null;
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

/**
 * The failure that belongs to the latest turn. OpenCode normally records a
 * provider failure on the assistant row; older servers append a failed idle
 * row instead. Both must reach the chat banner.
 */
export function openCodeConversationFailure(
  messages: SessionMessageInfo[],
): SessionStructuredError | null {
  const last = openCodeLastConversationMessage(messages);
  if (last?.type === "assistant" && last.retry) return null;
  if (last?.type === "assistant" && last.error) return last.error;
  return openCodeExecutionFailure(messages);
}

const RATE_LIMIT_PATTERN =
  /rate.?limit|too many requests|quota|resource.?exhausted|limit exceeded/i;
const AUTH_PATTERN = /auth|unauthor|forbidden|invalid.*(?:key|token)|401|403/i;

/** Turn a structured harness failure into text a person can act on. */
export function openCodeErrorMessage(
  error: SessionStructuredError,
  label = "OpenCode",
): string {
  const detail = error.message?.trim() || error.type || "Unknown error";
  const status = error.status;
  const retry =
    typeof error.retryAfterMs === "number" && error.retryAfterMs > 0
      ? Math.ceil(error.retryAfterMs / 1000)
      : null;
  if (status === 429 || RATE_LIMIT_PATTERN.test(`${error.type} ${detail}`)) {
    return `${label} hit a rate limit${detail ? `: ${detail}` : ""}.${
      retry ? ` Try again in ${retry}s.` : ""
    } You can retry, or switch to another model/provider.`;
  }
  if (
    status === 401 ||
    status === 403 ||
    AUTH_PATTERN.test(`${error.type} ${detail}`)
  ) {
    return `${label} rejected the request${
      status ? ` (HTTP ${status})` : ""
    }: ${detail}. Reconnect or check the harness credentials.`;
  }
  if (typeof status === "number" && status >= 500) {
    return `${label} server error (HTTP ${status}): ${detail}. Try again shortly.`;
  }
  return `${label} failed: ${detail}`;
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
