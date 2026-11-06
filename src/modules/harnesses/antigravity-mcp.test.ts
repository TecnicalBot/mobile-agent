import { describe, expect, it } from "vitest";

import type { McpServerConfig } from "@/core/types/app-state";
import {
  ANTIGRAVITY_PHONE_MCP_SERVER,
  buildAntigravityMcpServers,
} from "./antigravity-mcp";

function server(
  overrides: Partial<McpServerConfig> & Pick<McpServerConfig, "id" | "label">,
): McpServerConfig {
  return {
    url: "https://mcp.example.com/mcp",
    transport: "http",
    authMode: "none",
    oauthMode: null,
    enabled: true,
    headerNames: [],
    oauthClientId: null,
    oauthAuthorizationUrl: null,
    oauthTokenUrl: null,
    oauthScopes: null,
    oauthAllowedAuthOrigin: null,
    lastStatus: "untested",
    lastError: null,
    toolCount: null,
    serverInfo: null,
    serverInstructions: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildAntigravityMcpServers", () => {
  it("maps only enabled servers in the current selection", () => {
    const result = buildAntigravityMcpServers({
      servers: [
        server({ id: "a", label: "Alpha" }),
        server({ id: "b", label: "Beta", enabled: false }),
        server({ id: "c", label: "Gamma", transport: "sse" }),
      ],
      selectedServerIds: ["a", "b"],
    });

    expect(result).toEqual([
      {
        type: "http",
        name: "Alpha",
        url: "https://mcp.example.com/mcp",
        headers: [],
      },
    ]);
  });

  it("treats a null selection as every enabled server", () => {
    const result = buildAntigravityMcpServers({
      servers: [
        server({ id: "a", label: "Alpha" }),
        server({ id: "c", label: "Gamma", transport: "sse" }),
      ],
      selectedServerIds: null,
    });

    expect(result.map((entry) => [entry.name, entry.type])).toEqual([
      ["Alpha", "http"],
      ["Gamma", "sse"],
    ]);
  });

  it("passes stored header values and OAuth access tokens", () => {
    const result = buildAntigravityMcpServers({
      servers: [
        server({ id: "headers", label: "Headers", authMode: "headers" }),
        server({ id: "oauth", label: "OAuth", authMode: "oauth" }),
      ],
      selectedServerIds: null,
      credentials: {
        headerValues: {
          headers: { "X-API-Key": "secret", "X-Empty": "" },
        },
        oauthTokens: { oauth: "access-token" },
      },
    });

    expect(result[0].headers).toEqual([
      { name: "X-API-Key", value: "secret" },
      { name: "X-Empty", value: "" },
    ]);
    expect(result[1].headers).toEqual([
      { name: "Authorization", value: "Bearer access-token" },
    ]);
  });

  it("includes phone tools as an authenticated HTTP server", () => {
    const result = buildAntigravityMcpServers({
      servers: [],
      selectedServerIds: null,
      phoneTools: {
        url: "http://192.168.1.20:7801/mcp",
        token: "phone-token",
      },
    });

    expect(result).toEqual([
      {
        type: "http",
        name: ANTIGRAVITY_PHONE_MCP_SERVER,
        url: "http://192.168.1.20:7801/mcp",
        headers: [
          { name: "Authorization", value: "Bearer phone-token" },
        ],
      },
    ]);
  });

  it("keeps names unique when a user server collides with phone tools", () => {
    const result = buildAntigravityMcpServers({
      servers: [
        server({
          id: "phone",
          label: ANTIGRAVITY_PHONE_MCP_SERVER,
        }),
      ],
      selectedServerIds: null,
      phoneTools: { url: "http://192.168.1.20:7801/mcp", token: "token" },
    });

    expect(result.map((entry) => entry.name)).toEqual([
      ANTIGRAVITY_PHONE_MCP_SERVER,
      `${ANTIGRAVITY_PHONE_MCP_SERVER}_2`,
    ]);
  });

  it("sanitizes ACP server names for Antigravity tool names", () => {
    const result = buildAntigravityMcpServers({
      servers: [
        server({ id: "probe", label: "Probe MCP / Tools!" }),
        server({ id: "blank", label: "  " }),
      ],
      selectedServerIds: null,
    });

    expect(result.map((entry) => entry.name)).toEqual([
      "Probe_MCP_Tools",
      "mcp",
    ]);
  });

  it("skips servers without a URL", () => {
    const result = buildAntigravityMcpServers({
      servers: [server({ id: "empty", label: "Empty", url: "   " })],
      selectedServerIds: null,
    });

    expect(result).toEqual([]);
  });
});
