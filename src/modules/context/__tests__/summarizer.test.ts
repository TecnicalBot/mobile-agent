import { describe, expect, it } from "vitest";

import {
  SUMMARY_PREFIX,
  SUMMARY_TEMPLATE,
  buildSummaryPrompt,
  createSummaryMessage,
  findPreviousSummary,
  serializeForSummary,
} from "../summarizer";
import { contentMessage, msg, textPart } from "./test-fixtures";

describe("serializeForSummary", () => {
  it("labels user and assistant messages", () => {
    const messages = [msg("user", "hello"), msg("assistant", "hi there")];
    expect(serializeForSummary(messages)).toBe(
      "[User]: hello\n\n[Assistant]: hi there",
    );
  });

  it("joins text parts within a single message", () => {
    const messages = [
      contentMessage("assistant", [textPart("one"), textPart("two")]),
    ];
    expect(serializeForSummary(messages)).toBe("[Assistant]: one\ntwo");
  });

  it("includes reasoning and tool-result parts", () => {
    const messages = [
      contentMessage("assistant", [
        textPart("answer"),
        { type: "reasoning", text: "thinking" },
      ]),
      contentMessage("tool", [
        { type: "tool-result", toolCallId: "1", toolName: "read", output: "42" },
      ]),
    ];
    const serialized = serializeForSummary(messages);
    expect(serialized).toContain("[reasoning]: thinking");
    expect(serialized).toContain("[Tool]: [tool result]: 42");
  });

  it("drops empty messages", () => {
    const messages = [msg("user", "   "), msg("user", "real")];
    expect(serializeForSummary(messages)).toBe("[User]: real");
  });
});

describe("buildSummaryPrompt", () => {
  it("instructs to create a new summary when none exists", () => {
    const prompt = buildSummaryPrompt({ history: "[User]: hi" });
    expect(prompt).toContain("Create a new summary");
    expect(prompt).toContain(SUMMARY_TEMPLATE);
    expect(prompt).toContain("[User]: hi");
    expect(prompt).not.toContain("<previous-summary>");
  });

  it("anchors on the previous summary when one exists", () => {
    const prompt = buildSummaryPrompt({
      previousSummary: "old summary",
      history: "[User]: more",
    });
    expect(prompt).toContain("Update the summary below");
    expect(prompt).toContain("<previous-summary>");
    expect(prompt).toContain("old summary");
    expect(prompt).toContain("</previous-summary>");
  });
});

describe("createSummaryMessage / findPreviousSummary", () => {
  it("creates a summary system message", () => {
    const message = createSummaryMessage("the summary");
    expect(message.role).toBe("system");
    expect(String(message.content)).toContain(SUMMARY_PREFIX);
    expect(String(message.content)).toContain("the summary");
  });

  it("finds an existing summary message with its index", () => {
    const summary = createSummaryMessage("old facts");
    const messages = [msg("user", "a"), summary, msg("user", "b")];
    const found = findPreviousSummary(messages);
    expect(found).toEqual({ summary: "old facts", index: 1 });
  });

  it("returns undefined when no summary message exists", () => {
    const messages = [msg("user", "a"), msg("system", "plain system")];
    expect(findPreviousSummary(messages)).toBeUndefined();
  });
});
