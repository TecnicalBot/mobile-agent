import type { ASTNode } from "react-native-markdown-display";

/**
 * Flattens the chat markdown AST into runs of plain text that a single native
 * `<Text>` can paint.
 *
 * React Native only lets a selection grow inside one `<Text>`: `selectable`
 * maps to Android's `TextView.setTextIsSelectable` (one native text view) and
 * to a single attributed string on iOS, so two sibling `Text`s can never share
 * a selection. A reply rendered as one `Text` per paragraph/list item can
 * therefore only ever be selected one block at a time. This module folds every
 * textual block — paragraphs, headings, lists, quotes and inline styling —
 * into one newline-separated segment stream. A reply with five bullets
 * therefore becomes one selectable run.
 *
 * Code fences and tables keep their own card views: their header, copy button
 * and scrolling cannot exist inside a text span, so they stay separate and a
 * selection stops at them, exactly like images and rendered math.
 *
 * Kept free of `react-native` imports so the fold can be unit tested directly.
 */

/** Blocks that must keep their own view instead of flowing as text. */
const RICH_BLOCK_TYPES = new Set([
  "html_block",
  "html_inline",
  "math_block",
]);

const HEADING_TYPE = /^heading[1-6]$/;
const LIST_TYPES = new Set(["bullet_list", "ordered_list"]);

const BLOCK_GAP = "\n\n";
const LINE_BREAK = "\n";
const INDENT = "  ";
/** Stands in for the blockquote's left border, which a Text span cannot paint. */
const QUOTE_PREFIX = "▌ ";
const BULLET = "•";
const CHECKED = "☑";
const UNCHECKED = "☐";
const RULE = "────────";

export type SelectableSegmentStyle =
  | "body"
  | "code"
  | "em"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "link"
  | "muted"
  | "quoteBar"
  | "strike"
  | "strong";

export type SelectableSegment = {
  /** Set on link text so the renderer can attach a press handler. */
  href?: string;
  key: string;
  /** Set on code segments so the renderer can syntax-highlight them. */
  language?: string;
  style: SelectableSegmentStyle;
  text: string;
};

export type SelectableMarkdownChunk =
  | { key: string; kind: "rich"; node: ASTNode }
  | { key: string; kind: "text"; segments: SelectableSegment[] };

type BlockOptions = {
  /** Nesting level, used to indent nested list items and quotes. */
  depth: number;
  /** Whether an image may become its own view (only outside list/quote layouts). */
  richImages: boolean;
  style: SelectableSegmentStyle;
};

class SegmentWriter {
  private readonly chunks: SelectableMarkdownChunk[] = [];
  private segments: SelectableSegment[] = [];
  private counter = 0;

  text(value: string, style: SelectableSegmentStyle = "body", href?: string) {
    if (!value) {
      return;
    }

    const segment: SelectableSegment = {
      key: `segment-${this.counter++}`,
      style,
      text: value,
    };

    if (href) {
      segment.href = href;
    }

    this.segments.push(segment);
  }

  rich(node: ASTNode) {
    this.flush();
    this.chunks.push({ key: `block-${this.counter++}`, kind: "rich", node });
  }

  /** Drops the newlines a nested block left behind so callers pick the gap. */
  trimEnd() {
    trimBreaks(this.segments, "end");
  }

  get segmentCount() {
    return this.segments.length;
  }

  /** Marks every segment added since `from` as link text. */
  tagHref(from: number, href: string) {
    for (let index = from; index < this.segments.length; index += 1) {
      this.segments[index] = { ...this.segments[index], href };
    }
  }

  finish(): SelectableMarkdownChunk[] {
    this.flush();
    return this.chunks;
  }

  private flush() {
    trimBreaks(this.segments, "start");
    trimBreaks(this.segments, "end");

    if (this.segments.length > 0) {
      this.chunks.push({
        key: `text-${this.counter++}`,
        kind: "text",
        segments: this.segments,
      });
    }

    this.segments = [];
  }
}

function trimBreaks(segments: SelectableSegment[], edge: "start" | "end") {
  while (segments.length > 0) {
    const index = edge === "start" ? 0 : segments.length - 1;
    const segment = segments[index];
    const trimmed =
      edge === "start"
        ? segment.text.replace(/^\n+/, "")
        : segment.text.replace(/\n+$/, "");

    if (trimmed === segment.text) {
      return;
    }

    if (trimmed) {
      segments[index] = { ...segment, text: trimmed };
      return;
    }

    segments.splice(index, 1);
  }
}

function endBlock(writer: SegmentWriter) {
  writer.trimEnd();
  writer.text(BLOCK_GAP);
}

function imageAlt(node: ASTNode): string {
  const alt = String(node.attributes.alt ?? "").trim();
  return `[${alt || "image"}]`;
}

function trimCode(value: string): string {
  return value.replace(/\s+$/, "");
}

function appendInlineNode(
  node: ASTNode,
  writer: SegmentWriter,
  options: BlockOptions,
) {
  switch (node.type) {
    case "text":
      writer.text(node.content, options.style);
      return;
    case "softbreak":
    case "hardbreak":
      writer.text(LINE_BREAK, options.style);
      return;
    case "strong":
      appendInline(node, writer, { ...options, style: "strong" });
      return;
    case "em":
      appendInline(node, writer, { ...options, style: "em" });
      return;
    case "s":
      appendInline(node, writer, { ...options, style: "strike" });
      return;
    case "code_inline":
      writer.text(node.content, "code");
      return;
    case "link":
    case "blocklink": {
      const href = String(node.attributes.href ?? "");
      const start = writer.segmentCount;
      appendInline(node, writer, { ...options, style: "link" });

      if (href) {
        writer.tagHref(start, href);
      }

      return;
    }
    case "image":
      if (options.richImages) {
        writer.rich(node);
      } else {
        writer.text(imageAlt(node), "muted");
      }
      return;
    case "html_inline":
    case "html_block":
      // Inline SVG/HTML needs its own view, which a list item or quote cannot
      // host; fall back to the raw markup there.
      if (options.richImages) {
        writer.rich(node);
      } else {
        writer.text(trimCode(node.content), "code");
      }
      return;
    case "textgroup":
      appendInline(node, writer, options);
      return;
    default:
      if (node.children.length > 0) {
        appendInline(node, writer, options);
      } else if (node.content) {
        writer.text(node.content, options.style);
      }
  }
}

function appendInline(
  node: ASTNode,
  writer: SegmentWriter,
  options: BlockOptions,
) {
  for (const child of node.children) {
    appendInlineNode(child, writer, options);
  }
}

function listMarker(item: ASTNode, ordered: boolean, number: number): string {
  if (item.attributes.task === "true") {
    return item.attributes.checked === "true" ? CHECKED : UNCHECKED;
  }

  return ordered ? `${number}.` : BULLET;
}

function appendListItem(
  item: ASTNode,
  writer: SegmentWriter,
  options: BlockOptions & { marker: string },
) {
  writer.text(`${INDENT.repeat(options.depth)}${options.marker} `, options.style);

  let started = false;

  for (const child of item.children) {
    if (child.type === "paragraph" || child.type === "textgroup") {
      // A loose list item can hold several paragraphs; keep them on separate
      // lines instead of running them together.
      if (started) {
        writer.text(LINE_BREAK);
      }

      appendInline(child, writer, { ...options, richImages: false });
      started = true;
      continue;
    }

    writer.text(LINE_BREAK);
    started = true;

    if (LIST_TYPES.has(child.type)) {
      appendList(child, writer, {
        depth: options.depth + 1,
        style: options.style,
      });
      continue;
    }

    appendBlock(child, writer, {
      depth: options.depth + 1,
      richImages: false,
      style: options.style,
    });
  }

  writer.trimEnd();
  writer.text(LINE_BREAK);
}

function appendList(
  node: ASTNode,
  writer: SegmentWriter,
  { depth, style }: { depth: number; style: SelectableSegmentStyle },
) {
  const ordered = node.type === "ordered_list";
  const start = Number(node.attributes.start) || 1;
  let index = 0;

  for (const child of node.children) {
    if (child.type !== "list_item") {
      appendBlock(child, writer, { depth: depth + 1, richImages: false, style });
      continue;
    }

    appendListItem(child, writer, {
      depth,
      marker: listMarker(child, ordered, start + index),
      richImages: false,
      style,
    });
    index += 1;
  }

  writer.trimEnd();
}

function appendQuote(
  node: ASTNode,
  writer: SegmentWriter,
  { depth }: { depth: number },
) {
  const prefix = `${INDENT.repeat(depth)}${QUOTE_PREFIX}`;

  for (const child of node.children) {
    if (child.type === "paragraph" || child.type === "textgroup") {
      writer.text(prefix, "quoteBar");
      appendInline(child, writer, { depth, richImages: false, style: "muted" });
      writer.text(LINE_BREAK);
      continue;
    }

    if (LIST_TYPES.has(child.type)) {
      appendList(child, writer, { depth: depth + 1, style: "muted" });
      continue;
    }

    writer.text(prefix, "quoteBar");
    appendBlock(child, writer, {
      depth: depth + 1,
      richImages: false,
      style: "muted",
    });
  }

  writer.trimEnd();
}

function appendBlock(
  node: ASTNode,
  writer: SegmentWriter,
  options: BlockOptions,
) {
  if (HEADING_TYPE.test(node.type)) {
    appendInline(node, writer, {
      ...options,
      richImages: false,
      style: node.type as SelectableSegmentStyle,
    });
    endBlock(writer);
    return;
  }

  switch (node.type) {
    case "paragraph":
    case "textgroup":
      appendInline(node, writer, options);
      endBlock(writer);
      return;
    case "bullet_list":
    case "ordered_list":
      appendList(node, writer, options);
      endBlock(writer);
      return;
    case "blockquote":
      appendQuote(node, writer, options);
      endBlock(writer);
      return;
    case "list_item":
      appendListItem(node, writer, { ...options, marker: BULLET });
      return;
    case "hr":
      writer.text(RULE);
      endBlock(writer);
      return;
    case "fence":
    case "code_block":
    case "table":
      // Cards keep their chrome (header, copy button, scrolling), which a Text
      // span cannot paint — so they stay separate views.
      writer.rich(node);
      return;
    case "math_block":
      writer.text(trimCode(node.content), "code");
      endBlock(writer);
      return;
    case "html_block":
    case "html_inline":
      writer.text(node.content, "code");
      endBlock(writer);
      return;
    case "image":
      if (options.richImages) {
        writer.rich(node);
      } else {
        writer.text(imageAlt(node), "muted");
      }
      return;
    default:
      if (node.children.length > 0) {
        appendInline(node, writer, options);
        endBlock(writer);
      } else {
        writer.text(node.content, options.style);
      }
  }
}

export function buildSelectableMarkdown(
  ast: readonly ASTNode[],
): SelectableMarkdownChunk[] {
  const writer = new SegmentWriter();

  for (const node of ast) {
    if (RICH_BLOCK_TYPES.has(node.type)) {
      writer.rich(node);
      continue;
    }

    appendBlock(node, writer, { depth: 0, richImages: true, style: "body" });
  }

  return writer.finish();
}
