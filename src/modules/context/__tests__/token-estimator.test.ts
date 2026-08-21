import { describe, expect, it } from "vitest";

import {
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTokens,
} from "../token-estimator";
import {
  contentMessage,
  msg,
  reasoningPart,
  textPart,
  toolCallInputPart,
  toolResultOutputPart,
  toolResultPart,
} from "./test-fixtures";

describe("estimateTokens", () => {
  it("estimates 4 characters per token", () => {
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
  });

  it("rounds up partial tokens", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("estimateMessageTokens", () => {
  it("adds 4 token overhead to text messages", () => {
    expect(estimateMessageTokens(msg("user", "abcd"))).toBe(5);
  });

  it("estimates reasoning text at 3 chars per token", () => {
    const message = contentMessage("assistant", [
      textPart(""),
      reasoningPart("x".repeat(1200)),
    ]);
    expect(estimateMessageTokens(message)).toBe(4 + 0 + 400);
  });

  it("counts text parts but ignores reasoning length of zero", () => {
    const message = contentMessage("assistant", [textPart("abcd")]);
    expect(estimateMessageTokens(message)).toBe(5);
  });

  it("counts file/image parts as 1000 tokens each", () => {
    const message = contentMessage("user", [
      textPart("abcd"),
      { type: "file", mime: "image/png" },
      { type: "image", image: "data:" },
    ]);
    expect(estimateMessageTokens(message)).toBe(4 + 1 + 1000 + 1000);
  });

  it("counts tool-result parts with string content", () => {
    const message = contentMessage("tool", [toolResultPart("x".repeat(400))]);
    expect(estimateMessageTokens(message)).toBe(4 + 100);
  });

  it("counts tool-call parts with args", () => {
    const message = contentMessage("assistant", [
      { type: "tool-call", toolName: "read", args: { fileId: "123", path: "test.ts" } },
    ]);
    expect(estimateMessageTokens(message)).toBeGreaterThan(4);
  });

  it("counts tool-result parts with result object", () => {
    const message = contentMessage("tool", [
      { type: "tool-result", toolCallId: "call_1", result: { status: "success", data: "x".repeat(400) } },
    ]);
    expect(estimateMessageTokens(message)).toBeGreaterThan(100);
  });

  it("counts AI SDK v7 tool-call parts with input", () => {
    const message = contentMessage("assistant", [
      toolCallInputPart({ fileId: "123", path: "x".repeat(400) }),
    ]);
    expect(estimateMessageTokens(message)).toBeGreaterThan(100);
  });

  it("counts AI SDK v7 tool-result parts with text output", () => {
    const message = contentMessage("tool", [
      toolResultOutputPart({ type: "text", value: "x".repeat(400) }),
    ]);
    expect(estimateMessageTokens(message)).toBe(4 + 100);
  });

  it("counts AI SDK v7 tool-result parts with json output", () => {
    const message = contentMessage("tool", [
      toolResultOutputPart({ type: "json", value: { data: "x".repeat(400) } }),
    ]);
    expect(estimateMessageTokens(message)).toBeGreaterThan(100);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums message tokens", () => {
    const messages = [msg("user", "abcd"), msg("assistant", "abcdef")];
    expect(estimateMessagesTokens(messages)).toBe(5 + 6);
  });

  it("returns 0 for empty list", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});
