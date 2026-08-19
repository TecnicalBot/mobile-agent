import { describe, expect, it } from "vitest";

import { pruneToolOutputs } from "../pruner";
import {
  contentMessage,
  msg,
  textPart,
  toolResultPart,
} from "./test-fixtures";

const LARGE_TEXT = "x".repeat(7_000);
const SMALL_TEXT = "small";

function largeMessages(count: number, role: "user" | "assistant" = "user") {
  return Array.from({ length: count }, () => msg(role, LARGE_TEXT));
}

function smallTail(count: number) {
  return Array.from({ length: count }, () => msg("user", SMALL_TEXT));
}

describe("pruneToolOutputs", () => {
  it("returns messages unchanged when there are few messages", () => {
    const messages = [...largeMessages(4), ...smallTail(4)];
    expect(pruneToolOutputs(messages)).toBe(messages);
  });

  it("returns messages unchanged below the 15K prunable threshold", () => {
    const messages = [...largeMessages(8), ...smallTail(4)];
    expect(pruneToolOutputs(messages)).toBe(messages);
  });

  it("replaces large text with a placeholder above the threshold", () => {
    const messages = [...largeMessages(9), ...smallTail(4)];
    const pruned = pruneToolOutputs(messages);

    expect(pruned).not.toBe(messages);
    for (let i = 0; i < 9; i++) {
      expect(pruned[i]!.content).toMatch(
        /^\[Tool output pruned — ~1754 tokens\]$/,
      );
    }
  });

  it("protects the last four messages from pruning", () => {
    const tail = largeMessages(4);
    const messages = [...largeMessages(9), ...tail];
    const pruned = pruneToolOutputs(messages);

    for (let i = 0; i < 9; i++) {
      expect(pruned[i]!.content).toMatch(/^\[Tool output pruned/);
    }
    expect(pruned[9]!.content).toBe(LARGE_TEXT);
    expect(pruned[10]!.content).toBe(LARGE_TEXT);
    expect(pruned[11]!.content).toBe(LARGE_TEXT);
    expect(pruned[12]!.content).toBe(LARGE_TEXT);
  });

  it("only replaces text parts longer than 6000 characters", () => {
    const mixed = contentMessage("user", [
      textPart("keep me"),
      textPart(LARGE_TEXT),
    ]);
    const messages = [...largeMessages(8), mixed, ...smallTail(4)];
    const pruned = pruneToolOutputs(messages);

    const content = pruned[8]!.content as unknown as ReturnType<
      typeof textPart
    >[];
    expect(content[0]).toEqual(textPart("keep me"));
    expect(content[1]!.text).toMatch(/^\[Tool output pruned/);
  });

  it("prunes large real tool-result parts above threshold", () => {
    const toolMessages = Array.from({ length: 12 }, () =>
      contentMessage("tool", [toolResultPart("y".repeat(10_000))]),
    );
    const messages = [...toolMessages, ...smallTail(4)];

    const pruned = pruneToolOutputs(messages);
    expect(pruned).not.toBe(messages);
    const firstContent = pruned[0]!.content as unknown as ReturnType<
      typeof toolResultPart
    >[];
    expect(firstContent[0]!.content).toMatch(/^\[Tool output pruned/);
  });
});
