import MarkdownIt from "#app-markdown-it";
import type { ASTNode } from "react-native-markdown-display";
import { cleanupTokens } from "react-native-markdown-display/src/lib/util/cleanupTokens";
import groupTextTokens from "react-native-markdown-display/src/lib/util/groupTextTokens";
import omitListItemParagraph from "react-native-markdown-display/src/lib/util/omitListItemParagraph";
import { stringToTokens } from "react-native-markdown-display/src/lib/util/stringToTokens";
import tokensToAST from "react-native-markdown-display/src/lib/util/tokensToAST";
import { describe, expect, it } from "vitest";

import { registerChatMarkdownRules } from "@/modules/chat/markdown-rules";
import {
  buildSelectableMarkdown,
  type SelectableMarkdownChunk,
  type SelectableSegment,
} from "@/modules/chat/selectable-markdown";

const PARSER = registerChatMarkdownRules(
  MarkdownIt({ breaks: true, linkify: true, typographer: false }),
);

/**
 * Replays the library's own token pipeline so fixtures are the exact AST the
 * chat renderer paints (paragraphs omitted inside list items, `textgroup`
 * wrappers, block-flagged images…), not a hand-written approximation.
 */
function parse(source: string): ASTNode[] {
  let tokens = stringToTokens(source, PARSER);
  tokens = cleanupTokens(tokens);
  tokens = groupTextTokens(tokens);
  tokens = omitListItemParagraph(tokens);
  return tokensToAST(tokens) as ASTNode[];
}

type TextChunk = Extract<SelectableMarkdownChunk, { kind: "text" }>;

function textChunks(chunks: SelectableMarkdownChunk[]): TextChunk[] {
  return chunks.filter((chunk): chunk is TextChunk => chunk.kind === "text");
}

function textOf(chunk: SelectableMarkdownChunk): string {
  if (chunk.kind !== "text") {
    throw new Error("expected a text chunk");
  }

  return chunk.segments.map((segment) => segment.text).join("");
}

function segmentsOf(chunks: SelectableMarkdownChunk[]): SelectableSegment[] {
  return textChunks(chunks).flatMap((chunk) => chunk.segments);
}

describe("selectable markdown chunks", () => {
  it("keeps a whole bulleted answer in one selectable run", () => {
    const chunks = buildSelectableMarkdown(
      parse(
        [
          "Here are five options:",
          "",
          "- one",
          "- two",
          "- three",
          "- four",
          "- five",
          "",
          "Pick any.",
        ].join("\n"),
      ),
    );

    expect(chunks).toHaveLength(1);
    expect(textOf(chunks[0])).toBe(
      [
        "Here are five options:",
        "",
        "• one",
        "• two",
        "• three",
        "• four",
        "• five",
        "",
        "Pick any.",
      ].join("\n"),
    );
  });

  it("keeps headings and paragraphs in the same run as the list", () => {
    const chunks = buildSelectableMarkdown(
      parse("## Plan\n\nIntro paragraph.\n\n1. first\n2. second"),
    );

    expect(chunks).toHaveLength(1);
    expect(textOf(chunks[0])).toBe(
      "Plan\n\nIntro paragraph.\n\n1. first\n2. second",
    );
  });

  it("keeps code and table cards out of the text run", () => {
    const chunks = buildSelectableMarkdown(
      parse(
        [
          "## Plan",
          "",
          "- step one",
          "- step two",
          "",
          "```ts",
          "const x = 1;",
          "```",
          "",
          "| a | b |",
          "| - | - |",
          "| 1 | 2 |",
          "",
          "That's it.",
        ].join("\n"),
      ),
    );

    expect(chunks.map((chunk) => chunk.kind)).toEqual([
      "text",
      "rich",
      "rich",
      "text",
    ]);
    expect(textOf(chunks[0])).toBe("Plan\n\n• step one\n• step two");
    expect(textOf(chunks[3])).toBe("That's it.");
    expect(chunks[1].kind === "rich" && chunks[1].node.type).toBe("fence");
    expect(chunks[2].kind === "rich" && chunks[2].node.type).toBe("table");
  });

  it("indents nested list items", () => {
    const chunks = buildSelectableMarkdown(parse("- outer\n  - inner"));

    expect(textOf(chunks[0])).toBe("• outer\n  • inner");
  });

  it("keeps loose list item paragraphs on separate lines", () => {
    const chunks = buildSelectableMarkdown(
      parse("- first paragraph\n\n  second paragraph\n- next"),
    );

    expect(textOf(chunks[0])).toBe(
      "• first paragraph\nsecond paragraph\n• next",
    );
  });

  it("marks task list items", () => {
    const chunks = buildSelectableMarkdown(parse("- [x] done\n- [ ] todo"));

    expect(textOf(chunks[0])).toBe("☑ done\n☐ todo");
  });

  it("numbers ordered lists from their start attribute", () => {
    const chunks = buildSelectableMarkdown(parse("3. third\n4. fourth"));

    expect(textOf(chunks[0])).toBe("3. third\n4. fourth");
  });

  it("draws a quote bar in place of the blockquote border", () => {
    const chunks = buildSelectableMarkdown(parse("> quoted line"));

    expect(textOf(chunks[0])).toBe("▌ quoted line");
    expect(segmentsOf(chunks)[0]).toMatchObject({
      style: "quoteBar",
      text: "▌ ",
    });
  });

  it("keeps inline emphasis and code as styled segments", () => {
    const segments = segmentsOf(
      buildSelectableMarkdown(parse("**bold** and `code`")),
    );

    expect(
      segments.map((segment) => [segment.style, segment.text]),
    ).toEqual([
      ["strong", "bold"],
      ["body", " and "],
      ["code", "code"],
    ]);
  });

  it("carries link targets onto the link text", () => {
    const segments = segmentsOf(
      buildSelectableMarkdown(parse("see [the docs](https://example.dev) now")),
    );

    expect(segments).toEqual([
      expect.objectContaining({ style: "body", text: "see " }),
      expect.objectContaining({
        href: "https://example.dev",
        style: "link",
        text: "the docs",
      }),
      expect.objectContaining({ style: "body", text: " now" }),
    ]);
  });

  it("gives headings their own segment style", () => {
    const segments = segmentsOf(buildSelectableMarkdown(parse("## Title")));

    expect(segments).toEqual([
      expect.objectContaining({ style: "heading2", text: "Title" }),
    ]);
  });

  it("leaves images to their own view", () => {
    const chunks = buildSelectableMarkdown(
      parse("![chart](https://example.dev/chart.png)"),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind === "rich" && chunks[0].node.type).toBe("image");
  });

  it("drops no text when an image splits a paragraph", () => {
    const chunks = buildSelectableMarkdown(
      parse("before ![chart](https://example.dev/c.png) after"),
    );

    expect(chunks.map((chunk) => chunk.kind)).toEqual(["text", "rich", "text"]);
    expect(textOf(chunks[0])).toBe("before ");
    expect(textOf(chunks[2])).toBe(" after");
  });
});
