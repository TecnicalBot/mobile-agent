/**
 * How much of the optional prompt machinery a conversation can afford.
 *
 * - `full`: every system part, every enabled tool family.
 * - `compact`: same tools, but optional plugin instructions are dropped.
 * - `minimal`: core tools only (or none), optional system parts dropped.
 *   This is what keeps a 4k on-device / Ollama window usable.
 */
export type PromptProfile = "full" | "compact" | "minimal";

/** Below this window we assume tools + long instructions will not fit. */
export const MINIMAL_PROMPT_CONTEXT_WINDOW = 12_000;
/** Below this window we start trimming optional prompt parts. */
export const COMPACT_PROMPT_CONTEXT_WINDOW = 40_000;

/** A turn needs at least this much room for the user's own messages. */
export const MIN_USABLE_CONTEXT_TOKENS = 768;

export function resolvePromptProfile(input: {
  contextWindow?: number | null;
}): PromptProfile {
  const window = input.contextWindow ?? 32_000;

  if (window < MINIMAL_PROMPT_CONTEXT_WINDOW) {
    return "minimal";
  }

  if (window < COMPACT_PROMPT_CONTEXT_WINDOW) {
    return "compact";
  }

  return "full";
}

/**
 * True when the assembled prompt + tools leave too little room for messages.
 * Callers use this to shed optional families before the first model request.
 */
export function isPromptBudgetExceeded(input: {
  contextWindow: number;
  promptTokens: number;
  toolTokens: number;
  reservedTokens: number;
}): boolean {
  const available =
    input.contextWindow - input.reservedTokens - input.promptTokens - input.toolTokens;

  return available < MIN_USABLE_CONTEXT_TOKENS;
}
