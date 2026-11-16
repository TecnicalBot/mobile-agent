import { describe, expect, it } from "vitest";

import { continueComposerList } from "@/modules/chat/composer-lists";

describe("continueComposerList", () => {
  it("starts the next bullet when return is pressed in a bullet item", () => {
    expect(continueComposerList("- first", "- first\n")).toEqual({
      value: "- first\n- ",
      selection: { start: 10, end: 10 },
    });
  });

  it("keeps the bullet character the user typed", () => {
    expect(continueComposerList("* star", "* star\n")?.value).toBe(
      "* star\n* ",
    );
    expect(continueComposerList("+ plus", "+ plus\n")?.value).toBe(
      "+ plus\n+ ",
    );
  });

  it("increments a numbered item", () => {
    expect(continueComposerList("1. first", "1. first\n")).toEqual({
      value: "1. first\n2. ",
      selection: { start: 12, end: 12 },
    });
  });

  it("supports parenthesis-delimited numbering", () => {
    expect(continueComposerList("3) third", "3) third\n")?.value).toBe(
      "3) third\n4) ",
    );
  });

  it("keeps zero padding in numbered lists", () => {
    expect(continueComposerList("01. first", "01. first\n")?.value).toBe(
      "01. first\n02. ",
    );
  });

  it("preserves nested-list indentation", () => {
    expect(continueComposerList("  - nested", "  - nested\n")).toEqual({
      value: "  - nested\n  - ",
      selection: { start: 15, end: 15 },
    });
  });

  it("continues the list when return splits an item mid-line", () => {
    expect(continueComposerList("- one two", "- one\n two")).toEqual({
      value: "- one\n- two",
      selection: { start: 8, end: 8 },
    });
  });

  it("leaves the list when return is pressed on an empty bullet", () => {
    expect(continueComposerList("hello\n- ", "hello\n- \n")).toEqual({
      value: "hello\n",
      selection: { start: 6, end: 6 },
    });
  });

  it("leaves the list when return is pressed on an empty numbered item", () => {
    expect(continueComposerList("1. ", "1. \n")).toEqual({
      value: "",
      selection: { start: 0, end: 0 },
    });
  });

  it("presses return normally after a finished list item with content", () => {
    expect(continueComposerList("- done\n", "- done\n\n")).toBeNull();
  });

  it("ignores returns in plain paragraphs", () => {
    expect(continueComposerList("hello", "hello\n")).toBeNull();
  });

  it("ignores pasted text and multi-character changes", () => {
    expect(continueComposerList("", "- a\n- b")).toBeNull();
    expect(continueComposerList("- a", "- a\nx")).toBeNull();
  });
});
