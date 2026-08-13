import { describe, expect, it, vi } from "vitest";

import { prepareMessagesForLLMWithSummary } from "../index";
import { SUMMARY_PREFIX } from "../summarizer";
import { estimateMessagesTokens } from "../token-estimator";
import {
  fakeModel,
  msg,
  windowForUsable,
} from "./test-fixtures";

const MARKER =
  "[Earlier conversation was truncated to fit the model's context window.]";
const USABLE = 5_000;
const CONTEXT_WINDOW = windowForUsable(USABLE);

function turn(index: number) {
  return [
    msg("user", `user-${index}-`.padEnd(1000, "x")),
    msg("assistant", `assistant-${index}-`.padEnd(1000, "x")),
  ];
}

function turns(count: number) {
  return Array.from({ length: count }, (_, i) => turn(i)).flat();
}

describe("prepareMessagesForLLMWithSummary", () => {
  it("does not call the generator when under the budget", async () => {
    const generateSummary = vi.fn(async () => "unused");
    const messages = [...turn(0), ...turn(1)];

    const result = await prepareMessagesForLLMWithSummary({
      contextWindow: 1_000_000,
      messages,
      model: fakeModel(1_000_000),
      generateSummary,
    });

    expect(generateSummary).not.toHaveBeenCalled();
    expect(result.messages).toBe(messages);
    expect(result.didSummarize).toBe(false);
  });

  it("summarizes the head and keeps the recent tail verbatim", async () => {
    let captured = "";
    const generateSummary = vi.fn(async (prompt: string) => {
      captured = prompt;
      return "summary text";
    });
    const messages = turns(10);

    const result = await prepareMessagesForLLMWithSummary({
      contextWindow: CONTEXT_WINDOW,
      messages,
      model: fakeModel(CONTEXT_WINDOW),
      generateSummary,
    });

    expect(result.didSummarize).toBe(true);
    expect(result.didTruncate).toBe(false);
    expect(result.didPrune).toBe(false);
    expect(result.summaryText).toBe("summary text");

    expect(result.messages[0]!.role).toBe("system");
    expect(String(result.messages[0]!.content)).toContain(SUMMARY_PREFIX);
    expect(result.messages[0]!.content).toContain("summary text");

    // tail is exactly the last two turns
    expect(result.messages).toHaveLength(1 + 4);
    expect(result.messages[1]).toBe(messages[16]);
    expect(result.messages[result.messages.length - 1]).toBe(messages[19]);

    // the generator sees the head only, not the retained tail
    expect(captured).toContain("user-0");
    expect(captured).toContain("assistant-0");
    expect(captured).not.toContain("user-8");
    expect(captured).not.toContain("user-9");

    expect(estimateMessagesTokens(result.messages)).toBeLessThan(USABLE);
  });

  it("falls back to truncation when the generator fails", async () => {
    const generateSummary = vi.fn(async () => {
      throw new Error("provider down");
    });
    const messages = turns(10);

    const result = await prepareMessagesForLLMWithSummary({
      contextWindow: CONTEXT_WINDOW,
      messages,
      model: fakeModel(CONTEXT_WINDOW),
      generateSummary,
    });

    expect(result.didSummarize).toBe(false);
    expect(result.didTruncate).toBe(true);
    expect(result.messages.some((m) => m.content === MARKER)).toBe(true);
  });

  it("falls back to truncation when the generator returns nothing", async () => {
    const generateSummary = vi.fn(async () => "");
    const messages = turns(10);

    const result = await prepareMessagesForLLMWithSummary({
      contextWindow: CONTEXT_WINDOW,
      messages,
      model: fakeModel(CONTEXT_WINDOW),
      generateSummary,
    });

    expect(result.didSummarize).toBe(false);
    expect(result.didTruncate).toBe(true);
  });

  it("behaves like the deterministic path without a generator", async () => {
    const messages = turns(10);

    const result = await prepareMessagesForLLMWithSummary({
      contextWindow: CONTEXT_WINDOW,
      messages,
      model: fakeModel(CONTEXT_WINDOW),
    });

    expect(result.didSummarize).toBe(false);
    expect(result.didTruncate).toBe(true);
    expect(result.messages.some((m) => m.content === MARKER)).toBe(true);
  });

  it("anchors on the previous summary across repeated compactions", async () => {
    let captured = "";
    const generateSummary = vi.fn(async (prompt: string) => {
      captured = prompt;
      return "summary one";
    });

    const first = await prepareMessagesForLLMWithSummary({
      contextWindow: CONTEXT_WINDOW,
      messages: turns(10),
      model: fakeModel(CONTEXT_WINDOW),
      generateSummary,
    });
    expect(first.didSummarize).toBe(true);

    const generateSummary2 = vi.fn(async (prompt: string) => {
      captured = prompt;
      return "summary two";
    });
    const second = await prepareMessagesForLLMWithSummary({
      contextWindow: CONTEXT_WINDOW,
      messages: [...first.messages, ...turns(8)],
      model: fakeModel(CONTEXT_WINDOW),
      generateSummary: generateSummary2,
    });

    expect(second.didSummarize).toBe(true);
    expect(captured).toContain("<previous-summary>");
    expect(captured).toContain("summary one");
    expect(captured).not.toContain("user-17");
    expect(second.summaryText).toBe("summary two");
  });
});
