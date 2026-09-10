import { describe, expect, it, vi } from "vitest";

import { runPluginSetup } from "../sandbox";

describe("plugin sandbox", () => {
  it("loads a CommonJS plugin and passes options", async () => {
    const log = vi.fn();
    const result = await runPluginSetup({
      context: {
        emit: vi.fn(),
        fetch,
        log,
        secrets: { delete: vi.fn(), get: vi.fn(), set: vi.fn() },
        storage: { delete: vi.fn(), get: vi.fn(), set: vi.fn() },
      },
      id: "plugin/test",
      options: { greeting: "hello" },
      source: `module.exports = {
        setup(api, options) {
          api.log(options.greeting);
          return { system: [options.greeting] };
        }
      };`,
    });

    expect(result.ok).toBe(true);
    expect(log).toHaveBeenCalledWith("hello");
    if (result.ok) expect(result.plugin.hooks.system).toEqual(["hello"]);
  });

  it("rejects a plugin without setup", async () => {
    const result = await runPluginSetup({
      context: {} as never,
      id: "plugin/test",
      source: "module.exports = {};",
    });

    expect(result.ok).toBe(false);
  });
});
