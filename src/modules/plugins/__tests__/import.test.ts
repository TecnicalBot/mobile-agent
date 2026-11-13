import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Repositories } from "@/core/db/repositories/types";

import { buildPluginSource } from "../builder";
import { importPluginSource } from "../import";
import { MISSING_PLUGIN_HEADER_ERROR } from "../manifest";

vi.mock("../plugin-files", () => ({
  writePluginFile: vi.fn(async () => "file:///plugins/plugin.js"),
}));

function createRepositories() {
  const created: unknown[] = [];
  const pluginRepository = {
    create: vi.fn(async (input: unknown) => {
      created.push(input);
      return { ...(input as object), enabled: true, lastError: null };
    }),
    getById: vi.fn(async () => null),
    update: vi.fn(async () => undefined),
  };

  return {
    created,
    repositories: {
      pluginRepository,
    } as unknown as Repositories,
  };
}

const validSource = buildPluginSource({
  name: "weather-tools",
  version: "1.0.0",
  tools: [
    {
      name: "currentWeather",
      description: "Get the current weather for a city.",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      executeBody: "return { city: args.city, temperature: 20 };",
    },
  ],
});

describe("importPluginSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a plain script that is not a plugin", async () => {
    const { repositories } = createRepositories();

    const result = await importPluginSource(
      "module.exports = { run() { return 'hi'; } };",
      repositories,
    );

    expect(result).toEqual({ ok: false, error: MISSING_PLUGIN_HEADER_ERROR });
    expect(repositories.pluginRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a plugin whose setup throws before saving it", async () => {
    const { repositories } = createRepositories();

    const result = await importPluginSource(
      '// @mobile-agent-plugin {"name":"broken","version":"1.0.0"}\n' +
        "module.exports = { setup() { throw new Error('boom'); } };",
      repositories,
    );

    expect(result).toEqual({
      ok: false,
      error: "Plugin failed to load: Plugin setup failed: boom",
    });
    expect(repositories.pluginRepository.create).not.toHaveBeenCalled();
  });

  it("saves a plugin that loads successfully", async () => {
    const { repositories, created } = createRepositories();

    const result = await importPluginSource(validSource, repositories);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.name).toBe("weather-tools");
    expect(repositories.pluginRepository.create).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
  });
});
