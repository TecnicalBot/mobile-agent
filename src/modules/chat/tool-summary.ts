/**
 * Tool execution summaries are persisted JSON that `summarizeValue` cuts at
 * 240 chars, so the chat renderer routinely receives a truncated object. These
 * helpers render whatever survived: real JSON when it parses, otherwise a
 * salvage pass that keeps the complete scalar fields and all-string arrays that
 * are still present (the same technique as `readToolResourceReference`).
 */

/** Complete `"key": <scalar>` pairs, including a trailing string cut mid-way. */
const SCALAR_FIELD =
  /"([A-Za-z0-9_]+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?|true|false|null))/g;

/** `"key": [ ... ]` where the closing bracket may be the end of a truncated summary. */
const STRING_ARRAY_FIELD = /"([A-Za-z0-9_]+)"\s*:\s*\[([\s\S]*?)(?:\]|$)/g;

const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/g;

/**
 * Array bodies made only of string literals — anything else is an object array.
 * A trailing partial literal is tolerated: truncation routinely cuts the last
 * name in half, and the complete names before it are still worth showing.
 */
const ONLY_STRING_LITERALS =
  /^\s*(?:"(?:[^"\\]|\\.)*"\s*,?\s*)*(?:"[^"]*)?$/;

/** Keys the trace renders through dedicated UI (thumbnails, code blocks). */
const RESERVED_KEYS = new Set([
  "content",
  "contentPreview",
  "displayName",
  "fileId",
  "height",
  "inlineFile",
  "inlineImage",
  "link",
  "mimeType",
  "width",
]);

/** Fields an object-array item can be labelled with, in preference order. */
const ITEM_LABEL_KEYS = ["displayName", "name", "path", "title"] as const;

/** Summaries report file/asset sizes in bytes; render those for humans. */
const BYTE_FIELD = /(?:^size$|bytes$|Bytes$)/;

/** Video/audio summaries report lengths in seconds. */
const DURATION_FIELD = /(?:^duration$|Duration$)/;

function formatByteSize(size: number) {
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSeconds(seconds: number) {
  if (seconds < 60) {
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }

  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

function formatScalar(key: string, value: string | number | boolean) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (BYTE_FIELD.test(key)) {
      return formatByteSize(value);
    }
    if (DURATION_FIELD.test(key)) {
      return formatSeconds(value);
    }
  }

  return String(value);
}

function unescapeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function salvageSummaryFields(text: string) {
  const fields: Record<string, unknown> = {};

  for (const match of text.matchAll(STRING_ARRAY_FIELD)) {
    const key = match[1];
    const body = match[2] ?? "";

    if (!ONLY_STRING_LITERALS.test(body)) {
      continue;
    }

    const items: string[] = [];
    for (const item of body.matchAll(STRING_LITERAL)) {
      items.push(unescapeJsonString(item[1]));
    }

    if (items.length > 0) {
      fields[key] = items;
    }
  }

  for (const match of text.matchAll(SCALAR_FIELD)) {
    const key = match[1];
    const stringValue = match[2];
    const literal = match[3];

    if (key in fields) {
      continue;
    }

    if (stringValue !== undefined) {
      fields[key] = unescapeJsonString(stringValue);
    } else if (literal !== undefined) {
      fields[key] =
        literal === "true"
          ? true
          : literal === "false"
            ? false
            : literal === "null"
              ? null
              : Number(literal);
    }
  }

  return fields;
}

/** Parse a persisted summary, recovering readable fields when it is truncated. */
export function parseToolSummary(
  summary: string | null | undefined,
): Record<string, unknown> {
  if (!summary) {
    return {};
  }

  try {
    const value = JSON.parse(summary);

    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return salvageSummaryFields(summary);
  }
}

/** A short label for one item of an array-valued field. */
function itemLabel(item: unknown): string | null {
  if (typeof item === "string" || typeof item === "number") {
    return String(item);
  }

  if (item && typeof item === "object") {
    for (const key of ITEM_LABEL_KEYS) {
      const value = (item as Record<string, unknown>)[key];

      if (typeof value === "string" && value) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Human-readable `key: value` lines for a summary, including arrays (which the
 * renderer used to drop, hiding every list-shaped tool result). Scalars render
 * before arrays so counts read ahead of long lists.
 */
export function formatSummaryLines(
  summary: string | null | undefined,
): string[] {
  const entries = Object.entries(parseToolSummary(summary)).filter(
    ([key]) => !RESERVED_KEYS.has(key),
  );
  const lines: string[] = [];

  const push = (key: string, rendered: string) => {
    lines.push(`${key.replace(/([A-Z])/g, " $1")}: ${rendered}`);
  };

  for (const [key, value] of entries) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      push(key, formatScalar(key, value));
    }
  }

  for (const [key, value] of entries) {
    if (!Array.isArray(value)) {
      continue;
    }

    const items = value
      .map(itemLabel)
      .filter((item): item is string => item !== null);

    if (items.length > 0) {
      push(key, items.join(", "));
    }
  }

  return lines;
}
