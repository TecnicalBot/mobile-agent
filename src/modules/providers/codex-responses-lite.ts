/**
 * The Codex backend serves the GPT-5.6 and GPT-6 families through a second
 * wire contract called "Responses Lite". It mirrors the standard Responses
 * shape but rejects the pieces those models no longer read:
 *
 * - top-level `instructions` (the prompt has to be a `developer` input item),
 * - top-level `tools` (they ride along as an `additional_tools` input item),
 * - `system` input items (`developer` items are accepted instead),
 * - parallel tool calls, and reasoning that is not scoped to all turns.
 *
 * The official client decides this from `use_responses_lite` in its bundled
 * model catalog; we mirror the same model set here.
 * https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json
 */
export const CODEX_COMPATIBILITY_VERSION = "0.144.0";
export const CODEX_RESPONSES_LITE_HEADER =
  "x-openai-internal-codex-responses-lite";
export const CODEX_SESSION_AFFINITY_HEADER = "x-session-affinity";

const RESPONSES_LITE_MODEL_PATTERN = /^gpt-(?:5\.6|6)(?:[.-]|$)/i;

export function isCodexResponsesLiteModel(modelId: string) {
  return RESPONSES_LITE_MODEL_PATTERN.test(modelId);
}

function stripImageDetail(value: unknown) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      stripImageDetail(entry);
    }

    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;

  if (record.type === "input_image") {
    delete record.detail;
  }

  for (const entry of Object.values(record)) {
    stripImageDetail(entry);
  }
}

function toDeveloperMessage(item: unknown) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }

  const record = item as Record<string, unknown>;

  return record.role === "system" ? { ...record, role: "developer" } : item;
}

/**
 * Rewrites a parsed Responses request body into the Responses Lite shape.
 * Returns null when the body is not a Responses request we can reshape, so the
 * caller can fall back to its standard handling.
 */
export function prepareCodexResponsesLiteBody(
  body: Record<string, unknown>,
  sessionId?: string | null,
): Record<string, unknown> | null {
  if (!Array.isArray(body.input)) {
    return null;
  }

  const tools = Array.isArray(body.tools) ? body.tools : [];
  const instructions =
    typeof body.instructions === "string" ? body.instructions.trim() : "";
  const prefix: Record<string, unknown>[] = [
    { type: "additional_tools", role: "developer", tools },
  ];

  if (instructions) {
    prefix.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: instructions }],
    });
  }

  stripImageDetail(body.input);

  const reasoning =
    body.reasoning &&
    typeof body.reasoning === "object" &&
    !Array.isArray(body.reasoning)
      ? (body.reasoning as Record<string, unknown>)
      : {};

  const lite: Record<string, unknown> = {
    ...body,
    input: [...prefix, ...body.input.map(toDeveloperMessage)],
    reasoning: { ...reasoning, context: "all_turns" },
    parallel_tool_calls: false,
    tool_choice: "auto",
  };

  delete lite.tools;
  delete lite.instructions;
  // GPT-5.6/GPT-6 are reasoning models, so sampling knobs are not accepted.
  delete lite.temperature;
  delete lite.top_p;

  if (sessionId) {
    lite.prompt_cache_key = sessionId;
  } else {
    delete lite.prompt_cache_key;
  }

  return lite;
}

export function applyCodexResponsesLiteHeaders(
  headers: Headers,
  sessionId: string | null,
) {
  if (sessionId) {
    headers.set(CODEX_SESSION_AFFINITY_HEADER, sessionId);
  }

  headers.set(CODEX_RESPONSES_LITE_HEADER, "true");
  headers.set("version", CODEX_COMPATIBILITY_VERSION);
  // The body length changes in `prepareCodexResponsesLiteBody`.
  headers.delete("content-length");
}
