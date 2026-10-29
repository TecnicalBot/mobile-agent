import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgeMcpServer } from "./mcp-server";
import type { BridgeTool } from "./types";

const token = "a".repeat(64);
const BRIDGE_URL = "http://127.0.0.1:43877/mcp";

afterEach(() => vi.unstubAllGlobals());

/**
 * whatwg-fetch (React Native) keeps the body as text but exposes no readable
 * stream, so the SDK's body reader fails even though the request is valid.
 */
function reactNativeRequest(
  body: string,
  headers: Record<string, string> = {},
) {
  const request = new Request(BRIDGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": String(body.length),
      ...headers,
    },
    body,
  });
  Object.defineProperty(request, "body", { value: undefined });
  return request;
}

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

  it("accepts requests from a runtime whose Request has no body stream", async () => {
    // Match RN's get-random-values shim: crypto exists, randomUUID does not.
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", { getRandomValues });
    vi.stubGlobal(
      "AbortController",
      class extends AbortController {
        constructor() {
          super();
          Object.defineProperty(this.signal, "throwIfAborted", {
            value: undefined,
          });
        }
      },
    );
    const { bridge } = setup();
    try {
      expect(globalThis.crypto.getRandomValues).toBe(getRandomValues);
      expect(typeof globalThis.crypto.randomUUID).toBe("function");
      const initialize = await bridge.handle(
        reactNativeRequest(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "opencode", version: "2.1.2" },
            },
          }),
        ),
      );
      expect(initialize.status).toBe(200);
      const session = initialize.headers.get("mcp-session-id");
      expect(session).toBeTruthy();

      const initialized = await bridge.handle(
        reactNativeRequest(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }),
          { "mcp-session-id": session! },
        ),
      );
      expect(initialized.status).toBe(202);

      const listed = await bridge.handle(
        reactNativeRequest(
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          { "mcp-session-id": session! },
        ),
      );
      expect(listed.status).toBe(200);
      const payload = await listed.json();
      expect(
        payload.result.tools.map((tool: { name: string }) => tool.name),
      ).toEqual(["phoneFolderRead"]);

      const called = await bridge.handle(
        reactNativeRequest(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "phoneFolderRead",
              arguments: { path: "native.txt" },
            },
          }),
          { "mcp-session-id": session! },
        ),
      );
      expect(called.status).toBe(200);
      expect((await called.json()).result.isError).not.toBe(true);
    } finally {
      await bridge.close();
    }
  });

  it("queues approval prompts for concurrent calls without losing either decision", async () => {
    const { bridge, client, transport, approve, execute } = setup();
    let decideFirst!: (accepted: boolean) => void;
    approve.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          decideFirst = resolve;
        }),
    );
    try {
      await client.connect(transport);
      const first = client.callTool({
        name: "phoneFolderRead",
        arguments: { path: "first.txt" },
      });
      await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce());
      const second = client.callTool({
        name: "phoneFolderRead",
        arguments: { path: "second.txt" },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(approve).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
      decideFirst(false);
      expect((await first).isError).toBe(true);
      expect((await second).isError).not.toBe(true);
      expect(approve).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      decideFirst?.(false);
      await client.close();
      await bridge.close();
    }
  });

  it("rejects authorized requests whose body is not JSON", async () => {
    const { bridge } = setup();
    try {
      const response = await bridge.handle(reactNativeRequest("not json"));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(-32700);
    } finally {
      await bridge.close();
    }
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
