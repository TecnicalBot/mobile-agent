import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_COMPOSER_TIP,
  fetchComposerTip,
  MAX_COMPOSER_TIP_LENGTH,
  parseComposerTip,
} from "@/modules/chat/composer-tip";

afterEach(() => vi.unstubAllGlobals());

function tip(parts: unknown[], enabled = true) {
  return { version: 1, enabled, parts };
}

describe("composer tip", () => {
  it("ships a valid offline default", () => {
    expect(DEFAULT_COMPOSER_TIP.enabled).toBe(true);
    expect(DEFAULT_COMPOSER_TIP.parts[0].text).toContain("Use @");
  });

  it("supports inline link labels and preserves spaces between parts", () => {
    expect(parseComposerTip(tip([
      { text: "Need\nhelp? " },
      { text: "Read the guide", url: "https://example.com/guide" },
    ])).parts).toEqual([
      { text: "Need help? " },
      { text: "Read the guide", url: "https://example.com/guide" },
    ]);
  });

  it("allows disabling the tip remotely", () => {
    expect(parseComposerTip(tip([], false))).toEqual({ enabled: false, parts: [] });
  });

  it("limits visible text across all parts without counting URL length", () => {
    expect(() => parseComposerTip(tip([
      { text: "a".repeat(MAX_COMPOSER_TIP_LENGTH), url: "https://example.com/guide" },
    ]))).not.toThrow();
    expect(() => parseComposerTip(tip([
      { text: "a".repeat(100) }, { text: "b".repeat(81) },
    ]))).toThrow("1–180");
  });

  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "file:///private/file",
    "https://user:secret@example.com",
    "not a URL",
  ])("rejects unsafe or invalid links: %s", (url) => {
    expect(() => parseComposerTip(tip([{ text: "Click", url }]))).toThrow();
  });

  it.each([
    null,
    { version: 2, enabled: true, parts: [{ text: "Tip" }] },
    { version: 1, enabled: "yes", parts: [] },
    tip([]),
    tip([{ text: "  " }]),
    tip([{ text: 123 }]),
    tip(Array.from({ length: 9 }, () => ({ text: "tip" }))),
  ])("rejects malformed content: %j", (value) => {
    expect(() => parseComposerTip(value)).toThrow();
  });

  it("fetches and validates remote text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      tip([{ text: "A remote tip" }]),
    )));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchComposerTip()).parts[0].text).toBe("A remote tip");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects failed requests so the query keeps its existing tip", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(fetchComposerTip()).rejects.toThrow("404");
  });

  it("rejects oversized payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(" ".repeat(16_385))));
    await expect(fetchComposerTip()).rejects.toThrow("too large");
  });
});
