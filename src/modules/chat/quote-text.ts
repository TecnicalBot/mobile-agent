/**
 * Helpers for the "Quote (Ask)" flow: text highlighted in an AI reply via the
 * native selection menu is turned into a markdown blockquote and dropped into
 * the composer.
 */

/**
 * Formats selected text as a markdown blockquote, preserving line breaks.
 * Returns `null` when the selection is empty or whitespace only.
 */
export function formatQuotedText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Appends a quoted block to the current composer value, separating it from
 * existing content with a blank line so the user can type their question below.
 */
export function appendQuote(current: string, quote: string): string {
  return current.trim().length > 0
    ? `${current.trimEnd()}\n\n${quote}\n`
    : `${quote}\n`;
}
