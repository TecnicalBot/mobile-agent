import type { SessionMessageInfo } from "@opencode/client";

/**
 * A completed assistant step with reasoning but no visible text or tool call is
 * never a useful answer. OpenCode currently reports it as a successful stop
 * (and the app would otherwise show the previous tool row and then silence).
 */
export function openCodeStalledAssistant(
  messages: SessionMessageInfo[],
): Extract<SessionMessageInfo, { type: "assistant" }> | null {
  const last = messages.at(-1);
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

/** Synthetic input is not shown as a user bubble, but resumes the session. */
export const OPENCODE_CONTINUATION_PROMPT =
  "Continue from where you left off. The previous step ended without a response. Call the next tool if one is needed, then give the user a complete final answer. Do not repeat tools whose results are already in the conversation.";
