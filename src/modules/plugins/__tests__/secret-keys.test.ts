import { describe, expect, it } from "vitest";

import { extractRequiredSecretKeys } from "../secret-keys";

describe("extractRequiredSecretKeys", () => {
  it("collects literal keys referenced via api.secrets.get", () => {
    const source = [
      "module.exports = {",
      "  setup(api, options) {",
      "    return { tool: {",
      "      run: {",
      "        async execute(args, context) {",
      '          const key = await api.secrets.get("WUNDERLIST_API_KEY");',
      '          const other = await api.secrets.get("SECOND_KEY");',
      "        },",
      "      },",
      "    } };",
      "  },",
      "};",
    ].join("\n");

    expect(extractRequiredSecretKeys(source)).toEqual([
      "WUNDERLIST_API_KEY",
      "SECOND_KEY",
    ]);
  });

  it("supports single-quoted keys and de-duplicates", () => {
    const source = `await api.secrets.get('TOKEN_A'); await api.secrets.get("TOKEN_A");`;
    expect(extractRequiredSecretKeys(source)).toEqual(["TOKEN_A"]);
  });

  it("ignores set/delete and dynamic keys", () => {
    const source = [
      '  api.secrets.set("STORE_ME", "x");',
      '  api.secrets.delete("REMOVE_ME");',
      '  await api.secrets.get("PREFIX_" + args.suffix);',
    ].join("\n");

    expect(extractRequiredSecretKeys(source)).toEqual([]);
  });

  it("derives keys from built plugin sources", async () => {
    const { buildPluginSource } = await import("../builder");
    const source = buildPluginSource({
      name: "api-plugin",
      version: "1.0.0",
      tools: [
        {
          name: "query",
          description: "Query an API",
          inputSchema: {},
          executeBody:
            'api.log("calling"); return await api.secrets.get("MY_TOKEN");',
        },
      ],
    });

    expect(extractRequiredSecretKeys(source)).toEqual(["MY_TOKEN"]);
  });
});