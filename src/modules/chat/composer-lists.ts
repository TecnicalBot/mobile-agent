/**
 * Smart list editing for the chat composer.
 *
 * The composer sends markdown, so the draft is plain text. This module makes
 * that text behave like a list editor while typing: pressing return inside a
 * bullet or numbered item starts the next item, and return on an empty item
 * leaves the list. Markers stay as markdown (`- `, `1. `) because that is what
 * gets sent and rendered in the chat.
 */

export type ComposerSelection = {
  start: number;
  end: number;
};

type ListMatch = {
  indent: string;
  marker: string;
  number: string | null;
  delimiter: string | null;
  content: string;
};

const LIST_PATTERN = /^(\s*)([-*+]|(\d+)([.)]))\s+(.*)$/;

function parseListLine(line: string): ListMatch | null {
  const match = LIST_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  return {
    indent: match[1],
    marker: match[2],
    number: match[3] ?? null,
    delimiter: match[4] ?? null,
    content: match[5],
  };
}

/**
 * Finds the index of a newline that was just typed into the draft. Only plain
 * character insertions are handled so paste/autocorrect replacements never
 * rewrite the user's text unexpectedly.
 */
function findTypedNewline(previousValue: string, nextValue: string) {
  if (nextValue.length !== previousValue.length + 1) {
    return null;
  }

  let index = 0;
  while (
    index < previousValue.length &&
    previousValue[index] === nextValue[index]
  ) {
    index += 1;
  }

  if (nextValue[index] !== "\n") {
    return null;
  }

  // Everything after the inserted newline must still match the old text.
  if (nextValue.slice(index + 1) !== previousValue.slice(index)) {
    return null;
  }

  return index;
}

function nextOrderedMarker(list: ListMatch) {
  const number = Number.parseInt(list.number ?? "1", 10);
  const nextNumber = (Number.isFinite(number) ? number : 0) + 1;
  // Keep zero-padding such as `01.` → `02.`.
  const width = (list.number ?? "").length;
  const formatted = String(nextNumber).padStart(width, "0");

  return `${formatted}${list.delimiter ?? "."}`;
}

/**
 * Returns the rewritten draft and caret position when the typed newline is
 * inside a list, or `null` when the input should be left untouched.
 */
export function continueComposerList(
  previousValue: string,
  nextValue: string,
): { value: string; selection: ComposerSelection } | null {
  const newlineIndex = findTypedNewline(previousValue, nextValue);
  if (newlineIndex === null) {
    return null;
  }

  const lineStart = nextValue.lastIndexOf("\n", newlineIndex - 1) + 1;
  const line = nextValue.slice(lineStart, newlineIndex);
  const list = parseListLine(line);

  if (!list) {
    return null;
  }

  // Return on an empty item leaves the list instead of creating an endless
  // stream of bullets. The marker line and its newline both go away.
  if (!list.content.trim()) {
    const value =
      nextValue.slice(0, lineStart) + nextValue.slice(newlineIndex + 1);

    return {
      value,
      selection: { start: lineStart, end: lineStart },
    };
  }

  const marker =
    list.number === null ? list.marker : nextOrderedMarker(list);
  const insertion = `${list.indent}${marker} `;
  const caret = newlineIndex + 1 + insertion.length;
  // Splitting an item before a space (`- one| two`) would otherwise leave a
  // double space after the new marker.
  let remainder = nextValue.slice(newlineIndex + 1);
  if (
    previousValue[newlineIndex] === " " &&
    remainder.startsWith(" ")
  ) {
    remainder = remainder.slice(1);
  }
  const value =
    nextValue.slice(0, newlineIndex + 1) + insertion + remainder;

  return {
    value,
    selection: { start: caret, end: caret },
  };
}
