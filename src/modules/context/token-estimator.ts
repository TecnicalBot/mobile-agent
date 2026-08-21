import type { ModelMessage } from "ai";

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_ESTIMATE = 1000;
const REASONING_CHARS_PER_TOKEN = 3;

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type ToolOutputValue = { type?: string; value?: unknown };

type ContentPartLike = {
  type: string;
  text?: string;
  content?: string | { type: string; text?: string }[];
  toolName?: string;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: ToolOutputValue;
};

function estimateOutputTokens(output: ToolOutputValue): number {
  if (typeof output.value === "string") {
    return estimateTextTokens(output.value);
  }
  if (Array.isArray(output.value)) {
    let tokens = 0;
    for (const inner of output.value) {
      if (
        typeof inner === "object" &&
        inner !== null &&
        typeof (inner as { text?: unknown }).text === "string"
      ) {
        tokens += estimateTextTokens((inner as { text: string }).text);
      }
    }
    return tokens;
  }
  if (output.value !== undefined && output.value !== null) {
    try {
      return estimateTextTokens(JSON.stringify(output.value));
    } catch {
      return 0;
    }
  }
  return 0;
}

function estimateContentArrayTokens(
  parts: ContentPartLike[],
): number {
  let tokens = 0;
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      tokens += estimateTextTokens(part.text);
    } else if (part.type === "reasoning" && typeof part.text === "string") {
      tokens += Math.ceil(part.text.length / REASONING_CHARS_PER_TOKEN);
    } else if (part.type === "file" || part.type === "image") {
      tokens += IMAGE_TOKEN_ESTIMATE;
    } else if (part.type === "tool-call") {
      tokens += estimateTextTokens(part.toolName ?? "");
      const callPayload = part.args ?? part.input;
      if (callPayload !== undefined && callPayload !== null) {
        tokens += estimateTextTokens(
          typeof callPayload === "string"
            ? callPayload
            : JSON.stringify(callPayload),
        );
      }
    } else if (part.type === "tool-result") {
      if (typeof part.content === "string") {
        tokens += estimateTextTokens(part.content);
      } else if (Array.isArray(part.content)) {
        for (const inner of part.content) {
          if (typeof inner === "object" && inner !== null && typeof inner.text === "string") {
            tokens += estimateTextTokens(inner.text);
          }
        }
      }
      if (part.output && typeof part.output === "object") {
        tokens += estimateOutputTokens(part.output);
      }
      if (part.result !== undefined && part.result !== null) {
        tokens += estimateTextTokens(
          typeof part.result === "string"
            ? part.result
            : JSON.stringify(part.result),
        );
      }
    }
  }
  return tokens;
}

export function estimateTokens(content: string): number {
  return estimateTextTokens(content);
}

export function estimateMessageTokens(message: ModelMessage): number {
  const overhead = 4;
  let contentTokens = 0;

  if (typeof message.content === "string") {
    contentTokens = estimateTextTokens(message.content);
  } else if (Array.isArray(message.content)) {
    contentTokens = estimateContentArrayTokens(
      message.content as ContentPartLike[],
    );
  }

  return overhead + contentTokens;
}

export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}
