import type { ToolExecutionRecord } from "@/core/types/app-state";

/**
 * Preview text is persisted with every tool record (message metadata), so it
 * is bounded like the other captured content in the chat renderer.
 */
export const TOOL_PREVIEW_TEXT_LIMIT = 20_000;

/**
 * The only tool-output shapes a harness adapter needs to normalize. Direct
 * tools already know their own preview, but every remote harness eventually
 * reports text and/or files for a completed tool call.
 */
export type ToolPreviewContentPart =
  | { type: "text"; text: string }
  | { type: "file"; uri: string; mime: string; name?: string | null };

function previewString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A short, human-readable target for the trace row. */
export function toolPreviewTitle(fallback: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const record = input as Record<string, unknown>;
  const preferred = /bash|shell|command/i.test(fallback)
    ? ["command", "description"]
    : /grep|glob|search/i.test(fallback)
      ? ["pattern", "query", "path"]
      : [
          "filePath",
          "filepath",
          "path",
          "file",
          "filename",
          "command",
          "pattern",
          "query",
          "url",
          "description",
          "prompt",
          "name",
          "title",
        ];
  for (const key of preferred) {
    const value = previewString(record[key]);
    if (value) return value;
  }
  for (const value of Object.values(record)) {
    const text = previewString(value);
    if (text) return text;
  }
  return fallback;
}

/**
 * Remote host paths cannot be opened on this device. `allowFileImages` is for
 * local harnesses whose `file://` URIs really do exist on the phone.
 */
function isRenderableImage(uri: string, allowFileImages: boolean): boolean {
  return (
    /^https?:\/\//i.test(uri) ||
    /^data:image\//i.test(uri) ||
    /^workspace:\/\//i.test(uri) ||
    (allowFileImages && /^file:\/\//i.test(uri))
  );
}

/**
 * Build the same `preview` shape direct tools persist, from protocol-neutral
 * tool input and content parts. Harness adapters should call this instead of
 * inventing their own preview/title rules.
 */
export function buildToolPreview(input: {
  fallbackTitle: string;
  input?: unknown;
  content?: readonly ToolPreviewContentPart[] | null;
  allowFileImages?: boolean;
}): NonNullable<ToolExecutionRecord["preview"]> {
  const title = toolPreviewTitle(input.fallbackTitle, input.input);
  const preview: NonNullable<ToolExecutionRecord["preview"]> = { title };
  const textParts: string[] = [];
  const images: { uri: string; mimeType: string; title: string }[] = [];
  for (const item of input.content ?? []) {
    if (item.type === "text") {
      textParts.push(item.text);
    } else if (
      item.mime.startsWith("image/") &&
      isRenderableImage(item.uri, input.allowFileImages ?? false)
    ) {
      images.push({
        uri: item.uri,
        mimeType: item.mime,
        title: item.name?.trim() || title,
      });
    } else {
      // Never surface a host path, but still tell the user a file came back.
      textParts.push(`[file] ${item.name?.trim() || item.mime}`);
    }
  }
  const text = textParts.join("\n");
  if (text.trim()) {
    preview.text = text.slice(0, TOOL_PREVIEW_TEXT_LIMIT);
    preview.truncated = text.length > TOOL_PREVIEW_TEXT_LIMIT;
  }
  if (images.length === 1) {
    preview.uri = images[0].uri;
    preview.mimeType = images[0].mimeType;
  } else if (images.length > 1) {
    preview.images = images.map((image) => ({
      uri: image.uri,
      title: image.title,
    }));
  }
  return preview;
}
