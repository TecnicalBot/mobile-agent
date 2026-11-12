import type { ToolSet } from "ai";

import { describe, expect, it } from "vitest";

import { buildContextBreakdown, estimateToolTokens } from "../breakdown";
import { estimateMessagesTokens, estimateTokens } from "../token-estimator";
import { msg } from "./test-fixtures";

function tool(description: string) {
  return { description, inputSchema: { type: "object" } };
}

describe("estimateToolTokens", () => {
  it("measures only the named tools", () => {
    const tools = {
      read: tool("Read a file"),
      mcpSearch: tool("Search a remote index"),
    } as unknown as ToolSet;

    expect(estimateToolTokens(tools, ["read"])).toBe(
      estimateTokens(JSON.stringify({ read: tools.read })),
    );
    expect(estimateToolTokens(tools, ["missing"])).toBe(0);
    expect(estimateToolTokens(undefined)).toBe(0);
  });
});

describe("buildContextBreakdown", () => {
  it("merges sources with the same key and leaves free space at the end", () => {
    const messages = [msg("user", "hello")];
    const breakdown = buildContextBreakdown({
      contextWindow: 10_000,
      messages,
      reserved: 1_000,
      sources: [
        { key: "skills", label: "Skills", text: "a".repeat(400) },
        { key: "skills", label: "Skills", text: "b".repeat(400) },
        { key: "system", label: "System prompt", text: "c".repeat(800) },
      ],
    });

    const skills = breakdown.parts.find((part) => part.key === "skills");
    expect(skills?.tokens).toBe(200);
    expect(breakdown.parts.find((part) => part.key === "system")?.tokens).toBe(
      200,
    );
    expect(breakdown.usedTokens).toBe(
      400 + estimateMessagesTokens(messages),
    );
    expect(breakdown.parts.find((part) => part.key === "reserved")?.tokens).toBe(
      1_000,
    );
    expect(breakdown.parts.find((part) => part.key === "reserved")?.label).toBe(
      "Output & safety reserve",
    );
    expect(breakdown.parts.at(-1)).toMatchObject({
      key: "free",
      tokens: 10_000 - breakdown.usedTokens - 1_000,
    });
  });

  it("never reports negative free space", () => {
    const breakdown = buildContextBreakdown({
      contextWindow: 100,
      messages: [msg("user", "x".repeat(4_000))],
      reserved: 50,
      sources: [],
    });

    expect(breakdown.parts.at(-1)).toMatchObject({ key: "free", tokens: 0 });
  });

  it("omits zero-token sources and zero reserve", () => {
    const breakdown = buildContextBreakdown({
      contextWindow: 1_000,
      messages: [],
      reserved: 0,
      sources: [{ key: "system", label: "System prompt", text: "" }],
    });

    expect(breakdown.parts.map((part) => part.key)).toEqual(["free"]);
    expect(breakdown.usedTokens).toBe(0);
  });
});
