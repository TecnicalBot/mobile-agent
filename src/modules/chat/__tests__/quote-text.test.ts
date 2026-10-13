import { describe, expect, it } from "vitest";

import { appendQuote, formatQuotedText } from "@/modules/chat/quote-text";

describe("formatQuotedText", () => {
  it("prefixes each line with a blockquote marker", () => {
    expect(formatQuotedText("hello world")).toBe("> hello world");
  });

  it("preserves multiple lines", () => {
    expect(formatQuotedText("line one\nline two")).toBe(
      "> line one\n> line two",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(formatQuotedText("  spaced  ")).toBe("> spaced");
  });

  it("returns null for empty or whitespace-only selections", () => {
    expect(formatQuotedText("")).toBeNull();
    expect(formatQuotedText("   \n  ")).toBeNull();
  });
});

describe("appendQuote", () => {
  it("replaces an empty composer with the quote", () => {
    expect(appendQuote("", "> hi")).toBe("> hi\n");
  });

  it("appends below existing content with a blank line", () => {
    expect(appendQuote("What about this?", "> hi")).toBe(
      "What about this?\n\n> hi\n",
    );
  });

  it("ignores trailing whitespace on existing content", () => {
    expect(appendQuote("draft  \n", "> hi")).toBe("draft\n\n> hi\n");
  });
});
