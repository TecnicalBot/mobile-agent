const MAX_EDITS = 10;
const MAX_OLD_TEXT_LENGTH = 4_000;
const MAX_NEW_TEXT_LENGTH = 20_000;

export type TextEdit = {
  newText: string;
  oldText: string;
  replaceAll?: boolean;
};

function detectLineEnding(content: string) {
  const crlfCount = countOccurrences(content, "\r\n");
  const lfCount = countOccurrences(content, "\n");

  return crlfCount > 0 && crlfCount >= lfCount ? "\r\n" : "\n";
}

export function applyTextEdits(content: string, edits: TextEdit[]) {
  if (edits.length > MAX_EDITS) {
    throw new Error(`A maximum of ${MAX_EDITS} edits can be applied at once.`);
  }

  const lineEnding = detectLineEnding(content);
  let next = content.replace(/\r\n/g, "\n");
  let appliedCount = 0;

  for (const edit of edits) {
    const oldText = edit.oldText;

    if (!oldText) {
      continue;
    }

    if (oldText.length > MAX_OLD_TEXT_LENGTH) {
      throw new Error("An edit's oldText is too long to match reliably.");
    }

    if (edit.newText.length > MAX_NEW_TEXT_LENGTH) {
      throw new Error("An edit's newText exceeds the allowed size.");
    }

    const normalizedOldText = oldText.replace(/\r\n/g, "\n");
    const normalizedNewText = edit.newText.replace(/\r\n/g, "\n");
    const occurrences = countOccurrences(next, normalizedOldText);

    if (occurrences === 0) {
      throw new Error(
        "No exact match found for an edit. Read the file first and provide the exact text.",
      );
    }

    if (occurrences > 1 && !edit.replaceAll) {
      throw new Error(
        "An edit matches more than one location. Include surrounding context so each edit is unique, or set replaceAll to true to replace every occurrence.",
      );
    }

    next = next.replaceAll(normalizedOldText, normalizedNewText);
    appliedCount += 1;
  }

  if (lineEnding === "\r\n") {
    next = next.replace(/\n/g, "\r\n");
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
