const MAX_EDITS = 10;
const MAX_OLD_TEXT_LENGTH = 4_000;
const MAX_NEW_TEXT_LENGTH = 20_000;

export function applyTextEdits(
  content: string,
  edits: { newText: string; oldText: string }[],
) {
  if (edits.length > MAX_EDITS) {
    throw new Error(`A maximum of ${MAX_EDITS} edits can be applied at once.`);
  }

  let next = content;
  let appliedCount = 0;

  for (const edit of edits) {
    const oldText = edit.oldText.trim();

    if (!oldText) {
      continue;
    }

    if (oldText.length > MAX_OLD_TEXT_LENGTH) {
      throw new Error("An edit's oldText is too long to match reliably.");
    }

    if (edit.newText.length > MAX_NEW_TEXT_LENGTH) {
      throw new Error("An edit's newText exceeds the allowed size.");
    }

    const occurrences = countOccurrences(next, oldText);

    if (occurrences === 0) {
      throw new Error(
        "No exact match found for an edit. Read the file first and provide the exact text.",
      );
    }

    if (occurrences > 1) {
      throw new Error(
        "An edit matches more than one location. Include surrounding context so each edit is unique.",
      );
    }

    next = next.replace(oldText, edit.newText);
    appliedCount += 1;
  }

  return { appliedCount, content: next };
}

function countOccurrences(content: string, needle: string) {
  let count = 0;
  let fromIndex = 0;

  for (;;) {
    const index = content.indexOf(needle, fromIndex);

    if (index === -1) {
      break;
    }

    count += 1;
    fromIndex = index + needle.length;
  }

  return count;
}
