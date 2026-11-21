import { afterEach, expect, it, vi } from "vitest";

import bundledCatalog from "../../../../catalog/mcp-servers.json";
import { fetchMcpServerCatalog, parseMcpServerCatalog } from "../catalog";

const PUBLIC_SERVERS = [
  { id: "deepwiki", url: "https://mcp.deepwiki.com/mcp" },
  { id: "openai-developer-docs", url: "https://developers.openai.com/mcp" },
  { id: "aws-knowledge", url: "https://knowledge-mcp.global.api.aws/" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

it("bundled MCP catalog parses without dropping entries", () => {
  const presets = parseMcpServerCatalog(bundledCatalog);

  expect(presets).toHaveLength(bundledCatalog.servers.length);
});

it.each(PUBLIC_SERVERS)("$id is an opt-in public HTTP server", ({ id, url }) => {
  const preset = parseMcpServerCatalog(bundledCatalog).find(
    (server) => server.id === id,
  );

  expect(preset).toMatchObject({
    id,
    url,
    authMode: "none",
    defaultInstalled: false,
    headerTemplate: null,
    oauthMode: null,
    transport: "http",
  });
});

it("keeps OpenAI documentation separate from the existing OpenAI preset", () => {
  const presets = parseMcpServerCatalog(bundledCatalog);

  expect(presets.find((server) => server.id === "openai")?.url).toBe(
    "https://mcp.openai.com/",
  );
  expect(
    presets.find((server) => server.id === "openai-developer-docs")?.url,
  ).toBe("https://developers.openai.com/mcp");
});

it("rejects duplicate MCP catalog IDs", () => {
  const server = bundledCatalog.servers[0];

  expect(() =>
    parseMcpServerCatalog({ version: 1, servers: [server, server] }),
  ).toThrow(`Duplicate MCP catalog id: ${server.id}.`);
});

it.each(["offline", "invalid catalog"])(
  "keeps the public presets in the bundled fallback when %s",
  async (failure) => {
    vi.stubGlobal(
      "fetch",
      failure === "offline"
        ? vi.fn().mockRejectedValue(new Error("Offline"))
        : vi.fn().mockResolvedValue(Response.json({ version: 2, servers: [] })),
    );

    const result = await fetchMcpServerCatalog();

    expect(result.source).toBe("bundled");
    for (const { id } of PUBLIC_SERVERS) {
      expect(result.presets.some((server) => server.id === id)).toBe(true);
    }
  },
);
