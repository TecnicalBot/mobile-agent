import type { ModelMessage } from "ai";

export const SUMMARY_PREFIX = "[Session summary — earlier context]";

export const SUMMARY_TEMPLATE = `Summarize the conversation history into the sections below, in order. Keep every section, even when empty. Use short bullets instead of prose. Preserve exact file paths, commands, error strings, URLs, symbols, and identifiers when known. Do not mention the summary process or that context was compacted.

## Objective
- What the user is trying to accomplish, in one or two sentences

## Important Details
- Constraints, preferences, decisions and why, key facts, assumptions, or "(none)"

## Work State
### Completed
- Finished work, verified facts, or changes made; otherwise "(none)"

### Active
- Current work, partial changes, or investigation state; otherwise "(none)"

### Blocked
- Blockers, failing commands, or unknowns; otherwise "(none)"

## Next Move
1. The immediate concrete next action, or "(none)"
2. The following action if known, or "(none)"

## Relevant Files
- File or directory path: why it matters; otherwise "(none)"`;

function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
        if (part.type === "reasoning" && typeof part.text === "string") {
          return `[reasoning]: ${part.text}`;
        }
        if (part.type === "tool-result") {
          const value =
            "content" in part
              ? part.content
              : "output" in part
                ? part.output
                : undefined;
          const serialized =
            typeof value === "string"
              ? value
              : typeof value === "undefined"
                ? ""
                : JSON.stringify(value);
          return `[tool result]: ${serialized}`;
        }
        if (part.type === "file" || part.type === "image") {
          return `[${part.type}]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function roleLabel(role: ModelMessage["role"]): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "tool":
      return "Tool";
  }
}

export function serializeForSummary(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const text = textOf(message.content).trim();
      if (!text) return "";
      return `[${roleLabel(message.role)}]: ${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function buildSummaryPrompt(input: {
  previousSummary?: string;
  history: string;
}): string {
  const instruction = input.previousSummary?.trim()
    ? `Update the summary below using the conversation history. Keep details that are still true, remove stale ones, and merge in new facts.\n\n<previous-summary>\n${input.previousSummary.trim()}\n</previous-summary>`
    : "Create a new summary from the conversation history below.";

  return [instruction, SUMMARY_TEMPLATE, `Conversation history:\n\n${input.history}`].join(
    "\n\n",
  );
}

export function createSummaryMessage(summary: string): ModelMessage {
  return {
    role: "system",
    content: `${SUMMARY_PREFIX}\n${summary}`,
  } as ModelMessage;
}

export function findPreviousSummary(
  messages: ModelMessage[],
): { summary: string; index: number } | undefined {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== "system") continue;
    const content = typeof message.content === "string" ? message.content : "";
    const marker = content.indexOf(SUMMARY_PREFIX);
    if (marker === -1) continue;
    const summary = content.slice(marker + SUMMARY_PREFIX.length).trim();
    if (!summary) continue;
    return { summary, index: i };
  }
  return undefined;
}
