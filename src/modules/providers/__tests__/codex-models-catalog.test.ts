import { describe, expect, it } from "vitest";

import {
  getCodexBuiltInModels,
  isCodexOAuthModel,
  isModelAllowedByCodexCatalog,
  parseCodexModelCatalog,
} from "@/modules/providers/codex-models-catalog";

describe("bundled Codex model catalog", () => {
  it("ships the known-good Codex models as built-ins", () => {
    const ids = getCodexBuiltInModels().map((model) => model.id);

    expect(ids).toContain("gpt-5.5");
    expect(ids).toContain("gpt-5.4");
    expect(ids).toContain("gpt-5.4-mini");
  });

  it("rejects models the Codex backend refuses", () => {
    expect(isCodexOAuthModel("gpt-5.6")).toBe(false);
    expect(isCodexOAuthModel("gpt-5.6-pro")).toBe(false);
    expect(isCodexOAuthModel("gpt-5.5-pro")).toBe(false);
    expect(isCodexOAuthModel("gpt-5.3")).toBe(false);
    expect(isCodexOAuthModel("gpt-4o")).toBe(false);
    expect(isCodexOAuthModel("not-a-model")).toBe(false);
  });

  it("accepts allowlisted and newer models", () => {
    expect(isCodexOAuthModel("gpt-5.5")).toBe(true);
    expect(isCodexOAuthModel("gpt-5.4")).toBe(true);
    expect(isCodexOAuthModel("gpt-5.4-mini")).toBe(true);
    expect(isCodexOAuthModel("gpt-5.3-codex-spark")).toBe(true);
    expect(isCodexOAuthModel("gpt-6-sol")).toBe(true);
    expect(isCodexOAuthModel("gpt-6.1-sol")).toBe(true);
  });
});

describe("parseCodexModelCatalog", () => {
  it("requires schema version 1", () => {
    expect(() => parseCodexModelCatalog({ version: 2, models: [] })).toThrow();
    expect(() => parseCodexModelCatalog(null)).toThrow();
  });

  it("validates model definitions", () => {
    expect(() =>
      parseCodexModelCatalog({
        version: 1,
        models: [{ id: "Bad Id", kind: "chat" }],
      }),
    ).toThrow();
    expect(() =>
      parseCodexModelCatalog({
        version: 1,
        models: [{ id: "gpt-5.5", kind: "weird" }],
      }),
    ).toThrow();
    expect(() =>
      parseCodexModelCatalog({
        version: 1,
        models: [{ id: "gpt-5.5", kind: "chat", capabilities: { nope: true } }],
      }),
    ).toThrow();
  });

  it("rejects invalid deny patterns", () => {
    expect(() =>
      parseCodexModelCatalog({
        version: 1,
        models: [],
        denyPatterns: ["("],
      }),
    ).toThrow("not a valid regex");
  });

  it("accepts regex syntax without treating it as a model id", () => {
    const catalog = parseCodexModelCatalog({
      version: 1,
      models: [],
      denyPatterns: ["-pro$", "^gpt-5\\.6(?:-|$)"],
    });

    expect(isModelAllowedByCodexCatalog(catalog, "gpt-6-pro")).toBe(false);
    expect(isModelAllowedByCodexCatalog(catalog, "gpt-5.6-sol")).toBe(false);
    expect(isModelAllowedByCodexCatalog(catalog, "gpt-6-sol")).toBe(true);
  });

  it("still validates exact deny entries as model ids", () => {
    expect(() =>
      parseCodexModelCatalog({ version: 1, models: [], deny: ["-pro$"] }),
    ).toThrow("invalid model id");
  });

  it("applies deny, denyPatterns and minVersion", () => {
    const catalog = parseCodexModelCatalog({
      version: 1,
      models: [{ id: "gpt-5.5", kind: "chat", label: "GPT-5.5" }],
      deny: ["gpt-9"],
      denyPatterns: ["-pro$"],
      minVersion: "5.5",
    });

    expect(isModelAllowedByCodexCatalog(catalog, "gpt-5.5")).toBe(true);
    expect(isModelAllowedByCodexCatalog(catalog, "gpt-9")).toBe(false);
    expect(isModelAllowedByCodexCatalog(catalog, "gpt-6-pro")).toBe(false);
    expect(isModelAllowedByCodexCatalog(catalog, "gpt-6")).toBe(true);
    expect(isModelAllowedByCodexCatalog(catalog, "gpt-5.4")).toBe(false);
  });
});
