import { describe, expect, it, vi } from "vitest";

import { buildPluginSource, validatePluginSource } from "../builder";

describe("plugin builder", () => {
  it("builds a source that loads and exposes the tools as functions", async () => {
    const source = buildPluginSource({
      name: "my-plugin",
      version: "1.0.0",
      description: "A test plugin",
      tools: [
        {
          name: "echo",
          description: "Echo the greeting",
          inputSchema: {
            type: "object",
            properties: { greeting: { type: "string" } },
            required: ["greeting"],
          },
          executeBody: "return { greeting: args.greeting };",
        },
      ],
    });

    expect(source).toContain('"name":"my-plugin"');
    expect(source).toContain("module.exports = {");

    const result = await runPluginSetupWithContext(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const echo = result.plugin.hooks.tool?.echo;
    expect(echo).toBeDefined();
    expect(typeof echo?.execute).toBe("function");

    const output = await echo?.execute({ greeting: "hi" }, { abortSignal: new AbortController().signal });
    expect(output).toEqual({ greeting: "hi" });
  });

  it("includes system parts when provided", async () => {
    const source = buildPluginSource({
      name: "sys-plugin",
      version: "1.0.0",
      system: ["When asked, say via sys-plugin."],
    });

    const result = await runPluginSetupWithContext(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.hooks.system).toEqual(["When asked, say via sys-plugin."]);
  });

  it("validatePluginSource reports tool count for valid sources", async () => {
    const source = buildPluginSource({
      name: "count-plugin",
      version: "1.0.0",
      tools: [
        {
          name: "a",
          description: "A",
          inputSchema: {},
          executeBody: "return 1;",
        },
        {
          name: "b",
          description: "B",
          inputSchema: {},
          executeBody: "return 2;",
        },
      ],
    });

    const validation = await validatePluginSource(source);
    expect(validation).toEqual({ ok: true, toolCount: 2 });
  });

  it("validatePluginSource rejects broken JavaScript", async () => {
    const source = buildPluginSource({
      name: "broken-plugin",
      version: "1.0.0",
      tools: [
        {
          name: "bad",
          description: "Bad",
          inputSchema: {},
          executeBody: "return {",
        },
      ],
    });

    const validation = await validatePluginSource(source);
    expect(validation.ok).toBe(false);
  });
});

function runPluginSetupWithContext(source: string) {
  return import("../sandbox").then(({ runPluginSetup }) =>
    runPluginSetup({
      context: {
        emit: vi.fn(),
        fetch,
        log: vi.fn(),
        secrets: { delete: vi.fn(), get: vi.fn(), set: vi.fn() },
        storage: { delete: vi.fn(), get: vi.fn(), set: vi.fn() },
      },
      id: "plugin/test",
      source,
    }),
  );
}