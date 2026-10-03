import MarkdownIt from "#app-markdown-it";
import { describe, expect, it } from "vitest";

import { registerChatMarkdownRules } from "@/modules/chat/markdown-rules";

type AppToken = {
  attrs: [string, string][] | null;
  children: AppToken[] | null;
  content: string;
  type: string;
};

const PARSER = registerChatMarkdownRules(
  MarkdownIt({ breaks: true, linkify: true, typographer: false }),
);

function parse(source: string): AppToken[] {
  return PARSER.parse(source, {}) as unknown as AppToken[];
}

function attr(token: AppToken | undefined, name: string): string | undefined {
  return token?.attrs?.find(([key]) => key === name)?.[1];
}

describe("task list markdown rule", () => {
  it("marks a checked box and strips the marker", () => {
    const tokens = parse("- [x] done");
    const item = tokens.find((token) => token.type === "list_item_open");
    const inline = tokens.find((token) => token.type === "inline");

    expect(attr(item, "task")).toBe("true");
    expect(attr(item, "checked")).toBe("true");
    expect(inline?.children?.[0]?.content).toBe("done");
  });

  it("marks an unchecked box", () => {
    const tokens = parse("- [ ] todo");
    const item = tokens.find((token) => token.type === "list_item_open");

    expect(attr(item, "task")).toBe("true");
    expect(attr(item, "checked")).toBe("false");
    expect(tokens.find((token) => token.type === "inline")?.children?.[0]?.content).toBe(
      "todo",
    );
  });

  it("accepts an uppercase X", () => {
    const tokens = parse("- [X] done");
    const item = tokens.find((token) => token.type === "list_item_open");

    expect(attr(item, "checked")).toBe("true");
  });

  it("leaves ordinary items alone", () => {
    const tokens = parse("- plain");
    const item = tokens.find((token) => token.type === "list_item_open");

    expect(attr(item, "task")).toBeUndefined();
    expect(attr(item, "checked")).toBeUndefined();
    expect(tokens.find((token) => token.type === "inline")?.children?.[0]?.content).toBe(
      "plain",
    );
  });

  it("only matches a marker at the very start", () => {
    const tokens = parse("- see [x] notes");
    const item = tokens.find((token) => token.type === "list_item_open");

    expect(attr(item, "task")).toBeUndefined();
    expect(tokens.find((token) => token.type === "inline")?.children?.[0]?.content).toBe(
      "see [x] notes",
    );
  });

  it("does not mark ordered list items", () => {
    const tokens = parse("1. [x] done");
    const item = tokens.find((token) => token.type === "list_item_open");

    expect(attr(item, "task")).toBeUndefined();
  });

  it("handles nested lists independently", () => {
    const tokens = parse("- [ ] outer\n  - [x] inner");
    const items = tokens.filter((token) => token.type === "list_item_open");

    expect(items).toHaveLength(2);
    expect(attr(items[0], "checked")).toBe("false");
    expect(attr(items[1], "checked")).toBe("true");
  });

  it("requires whitespace after the marker", () => {
    const tokens = parse("- [x]done");
    const item = tokens.find((token) => token.type === "list_item_open");

    expect(attr(item, "task")).toBeUndefined();
  });
});