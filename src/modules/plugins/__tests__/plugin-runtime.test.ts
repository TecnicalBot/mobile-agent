import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginHooks, PluginHostContext } from "../types";

const { generateTextStream } = vi.hoisted(() => ({
  generateTextStream: vi.fn(async () => ({ text: "ai says hi" })),
}));

vi.mock("@/core/services/secrets", () => ({
  secureSecretStore: {
    deletePluginSecret: vi.fn(),
    getPluginSecret: vi.fn(async () => null),
    setPluginSecret: vi.fn(),
  },
}));

vi.mock("@/modules/runtime/model-runtime", () => ({
  modelRuntime: { generateTextStream },
}));

type HooksFactory = (context: PluginHostContext) => PluginHooks;
const hooksBox = vi.hoisted(() => ({ fn: ((_: PluginHostContext) => ({})) as any }));

vi.mock("../loader", () => ({
  loadAllPlugins: vi.fn(async (configs: any[], createContext: any) => {
    const plugins = configs.map((config) => {
      const context = createContext(config.id, config.options ?? undefined);
      return { context, hooks: hooksBox.fn(context), id: config.id };
    });
    return { errors: [], plugins };
  }),
}));

import { createPluginRuntime } from "../plugin-runtime";

const storage = {
  delete: vi.fn(async () => {}),
  get: vi.fn(async () => null),
  set: vi.fn(async () => {}),
};

const pluginConfig = (id: string, options?: Record<string, unknown>) =>
  ({
    author: null,
    createdAt: "",
    description: null,
    enabled: true,
    filePath: "",
    id,
    lastError: null,
    lastUpdateCheck: null,
    name: id,
    options: options ?? null,
    requiredSecrets: [],
    sourceUrl: null,
    updatedAt: "",
    version: "1.0.0",
  }) as any;

function getModelDefaults() {
  return { model: { modelId: "m" } as any, provider: { id: "p" } as any };
}

const signal = () => new AbortController().signal;

beforeEach(() => {
  hooksBox.fn = () => ({});
  generateTextStream.mockClear();
});

describe("plugin-runtime output routing", () => {
  async function setup(toolDef: any) {
    hooksBox.fn = () => ({ tool: { t: toolDef } } as any);
    const runtime = createPluginRuntime(storage, getModelDefaults);
    await runtime.load([pluginConfig("plugin/test")]);
    return runtime.snapshot("s");
  }

  it('returns raw output to the model for "model" routing (default)', async () => {
    const snapshot = await setup({
      description: "t",
      execute: async () => "raw data",
      inputSchema: {},
    });
    const t: any = snapshot.tools["plugin_plugin_test_t"];
    const out = await t.execute({}, { abortSignal: signal() });
    expect(out).toBe("raw data");
    expect(snapshot.pluginOutputs).toEqual([]);
  });

  it('stubs the model and records the user output for "user" routing', async () => {
    const snapshot = await setup({
      description: "t",
      execute: async () => ({ output: "visible!", title: "T" }),
      inputSchema: {},
      output: "user",
    });
    const t: any = snapshot.tools["plugin_plugin_test_t"];
    const out = await t.execute({}, { abortSignal: signal() });
    expect(out).toContain("Result shown to the user");
    expect(snapshot.pluginOutputs).toHaveLength(1);
    expect(snapshot.pluginOutputs[0]).toMatchObject({
      output: "visible!",
      title: "T",
    });
  });

  it('does not record anything for "silent" routing', async () => {
    const snapshot = await setup({
      description: "t",
      execute: async () => "secret",
      inputSchema: {},
      output: "silent",
    });
    const t: any = snapshot.tools["plugin_plugin_test_t"];
    const out = await t.execute({}, { abortSignal: signal() });
    expect(out).toContain("hidden from the model");
    expect(snapshot.pluginOutputs).toEqual([]);
  });

  it('returns raw output AND records it for "both" routing', async () => {
    const snapshot = await setup({
      description: "t",
      execute: async () => "both ways",
      inputSchema: {},
      output: "both",
    });
    const t: any = snapshot.tools["plugin_plugin_test_t"];
    const out = await t.execute({}, { abortSignal: signal() });
    expect(out).toBe("both ways");
    expect(snapshot.pluginOutputs[0]?.output).toBe("both ways");
  });
});

describe("plugin-runtime actions and api.ai", () => {
  it("runs actions and lets them call api.ai.generate", async () => {
    hooksBox.fn = (context: PluginHostContext) => ({
      action: {
        act: {
          title: "Act",
          async run() {
            const text = await context.ai.generate({ prompt: "hello" });
            return `done: ${text}`;
          },
        },
      },
    });

    const runtime = createPluginRuntime(storage, getModelDefaults);
    await runtime.load([pluginConfig("plugin/test")]);
    const snapshot = runtime.snapshot("s");

    expect(snapshot.actions).toHaveLength(1);
    expect(snapshot.actions[0].title).toBe("Act");

    const result = await snapshot.runAction("plugin/test", "act");
    expect(result).toBe("done: ai says hi");
    expect(generateTextStream).toHaveBeenCalledWith(
      expect.objectContaining({ system: undefined }),
    );
  });

  it("blocks api.ai inside tools by default", async () => {
    hooksBox.fn = (context: PluginHostContext) => ({
      tool: {
        t: {
          description: "t",
          inputSchema: {},
          async execute() {
            try {
              await context.ai.generate({ prompt: "x" });
              return "unexpected success";
            } catch (error) {
              return `blocked: ${(error as Error).message}`;
            }
          },
        },
      },
    });

    const runtime = createPluginRuntime(storage, getModelDefaults);
    await runtime.load([pluginConfig("plugin/test")]);
    const snapshot = runtime.snapshot("s");
    const t: any = snapshot.tools["plugin_plugin_test_t"];
    const out = await t.execute({}, { abortSignal: signal() });
    expect(out).toContain("allowAiInTools");
    expect(generateTextStream).not.toHaveBeenCalled();
  });

  it("allows api.ai inside tools when options.allowAiInTools is true", async () => {
    hooksBox.fn = (context: PluginHostContext) => ({
      tool: {
        t: {
          description: "t",
          inputSchema: {},
          async execute() {
            const text = await context.ai.generate({ prompt: "x" });
            return `ok: ${text}`;
          },
        },
      },
    });

    const runtime = createPluginRuntime(storage, getModelDefaults);
    await runtime.load([
      pluginConfig("plugin/test", { allowAiInTools: true }),
    ]);
    const snapshot = runtime.snapshot("s");
    const t: any = snapshot.tools["plugin_plugin_test_t"];
    const out = await t.execute({}, { abortSignal: signal() });
    expect(out).toBe("ok: ai says hi");
  });

  it("times out a hanging action", async () => {
    hooksBox.fn = () => ({
      action: {
        hang: {
          timeoutMs: 50,
          async run(_args: any, { abortSignal }: any) {
            await new Promise((resolve, reject) => {
              abortSignal.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
              setTimeout(resolve, 10_000);
            });
            return "never";
          },
        },
      },
    });

    const runtime = createPluginRuntime(storage, getModelDefaults);
    await runtime.load([pluginConfig("plugin/test")]);
    const snapshot = runtime.snapshot("s");
    await expect(snapshot.runAction("plugin/test", "hang")).rejects.toThrow();
  });

  it("enforces a per-tool timeout", async () => {
    hooksBox.fn = () => ({
      tool: {
        slow: {
          description: "slow",
          inputSchema: {},
          timeoutMs: 50,
          async execute(_args: any, { abortSignal }: any) {
            return new Promise<string>((resolve, reject) => {
              abortSignal.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
              setTimeout(() => resolve("late"), 10_000);
            });
          },
        },
      },
    });

    const runtime = createPluginRuntime(storage, getModelDefaults);
    await runtime.load([pluginConfig("plugin/test")]);
    const snapshot = runtime.snapshot("s");
    const t: any = snapshot.tools["plugin_plugin_test_slow"];
    await expect(
      t.execute({}, { abortSignal: signal() }),
    ).rejects.toThrow();
  });
});
