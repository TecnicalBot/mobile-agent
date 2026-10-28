import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { createBridgeMcpServer } from "./mcp-server";
import type { BridgeTool } from "./types";

const token = "a".repeat(64);

function setup(allow = true) {
  const execute = vi.fn(async (input: unknown) => ({ value: input }));
  const approve = vi.fn(async () => allow);
  const tool: BridgeTool = {
    name: "phoneFolderRead",
    description: "Read a shared phone file",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    parse: async (input) => {
      if (
        !input ||
        typeof input !== "object" ||
        !("path" in input) ||
        typeof input.path !== "string"
      )
        throw new Error("bad input");
      return input;
    },
    execute,
  };
  let id = 0;
  const bridge = createBridgeMcpServer({
    token,
    tools: [tool],
    randomId: () => `session-${++id}`,
    approve,
    isAvailable: () => true,
  });
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:43877/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => bridge.handle(new Request(input, init)),
    },
  );
  const client = new Client({
    name: "independent-test-client",
    version: "1.0.0",
  });
  return { bridge, transport, client, execute, approve };
}

describe("shared phone MCP bridge", () => {
  it("works with the official generic MCP client, not just OpenCode", async () => {
    const { bridge, client, transport, execute, approve } = setup();
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
        ["phoneFolderRead"],
      );
      const response = await client.callTool({
        name: "phoneFolderRead",
        arguments: { path: "report.txt" },
      });
      expect(response.isError).not.toBe(true);
      expect(execute).toHaveBeenCalledOnce();
      expect(approve).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await bridge.close();
    }
  });

  it("does not execute denied reads or writes", async () => {
    const { bridge, client, transport, execute } = setup(false);
    try {
      await client.connect(transport);
      expect(
        (
          await client.callTool({
            name: "phoneFolderRead",
            arguments: { path: "secret.txt" },
          })
        ).isError,
      ).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await bridge.close();
    }
  });

  it("validates arguments before asking permission", async () => {
    const { bridge, client, transport, execute, approve } = setup();
    try {
      await client.connect(transport);
      expect(
        (
          await client.callTool({
            name: "phoneFolderRead",
            arguments: { path: 1 },
          })
        ).isError,
      ).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await bridge.close();
    }
  });

  it("does not expose tools outside its immutable allowlist", async () => {
    const { bridge, client, transport, execute } = setup();
    try {
      await client.connect(transport);
      expect(
        (await client.callTool({ name: "executeShell", arguments: {} }))
          .isError,
      ).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await bridge.close();
    }
  });

  it("requires authorization, rejects browser Origins, and revokes all sessions on stop", async () => {
    const { bridge } = setup();
    expect(
      (await bridge.handle(new Request("http://127.0.0.1:43877/mcp"))).status,
    ).toBe(401);
    expect(
      (
        await bridge.handle(
          new Request("http://127.0.0.1:43877/mcp", {
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: "https://evil.example",
            },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await bridge.handle(
          new Request("http://evil.example/mcp", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(403);
    await bridge.close();
    expect(
      (
        await bridge.handle(
          new Request("http://127.0.0.1:43877/mcp", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(503);
  });

  it("rejects weak bridge secrets", () => {
    expect(() =>
      createBridgeMcpServer({
        token: "weak",
        tools: [],
        randomId: () => "id",
        approve: async () => true,
        isAvailable: () => true,
      }),
    ).toThrow();
  });
});
