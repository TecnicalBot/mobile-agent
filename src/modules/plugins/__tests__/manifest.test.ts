import { describe, expect, it } from "vitest";

import { manifestToId, parsePluginManifest } from "../manifest";

describe("plugin manifest", () => {
  it("parses the metadata header", () => {
    const result = parsePluginManifest(
      '// @mobile-agent-plugin {"name":"Weather Tools","version":"1.2.0","author":"Ada"}\nmodule.exports = {};',
    );

    expect(result).toEqual({
      manifest: {
        author: "Ada",
        description: undefined,
        name: "Weather Tools",
        version: "1.2.0",
      },
      ok: true,
    });
    if (result.ok) expect(manifestToId(result.manifest)).toBe("plugin/weather-tools");
  });

  it("rejects missing required metadata", () => {
    expect(parsePluginManifest("module.exports = {}" )).toEqual({
      error: "Missing // @mobile-agent-plugin { ... } header.",
      ok: false,
    });
  });
});
