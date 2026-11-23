import {
  isCodexResponsesLiteModel,
  prepareCodexResponsesLiteBody,
} from "@/modules/providers/codex-responses-lite";

export type PreparedCodexRequestBody = {
  body: Record<string, unknown>;
  responsesLite: boolean;
};

/**
 * Normalizes a parsed OpenAI Responses body for the Codex backend. Most models
 * keep the standard shape; the GPT-5.6/GPT-6 families need the Responses Lite
 * rewrite first.
 */
export function prepareCodexRequestBody(
  body: Record<string, unknown>,
  sessionId?: string | null,
): PreparedCodexRequestBody {
  delete body.max_output_tokens;
  body.store = false;

  if (typeof body.model === "string" && isCodexResponsesLiteModel(body.model)) {
    const liteBody = prepareCodexResponsesLiteBody(body, sessionId);

    if (liteBody) {
      return { body: liteBody, responsesLite: true };
    }
  }

  return { body, responsesLite: false };
}
