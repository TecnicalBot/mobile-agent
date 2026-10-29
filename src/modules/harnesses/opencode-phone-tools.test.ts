import { describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import {
  attachOpenCodePhoneTools,
  PHONE_TOOLS_SERVER,
} from "./opencode-phone-tools";

type Entry = { name: string; status: { status: string } };

function setup(options: { connected?: boolean; initial?: Entry[] } = {}) {
  const connected = options.connected ?? true;
  const servers = new Map<string, Entry>(
    (options.initial ?? []).map((entry) => [entry.name, entry]),
  );
  const mcp = {
    add: vi.fn(async (input: { server: string }) => {
      servers.set(input.server, {
        name: input.server,
        status: { status: "pending" },
      });
    }),
    connect: vi.fn(async ({ server }: { server: string }) => {
      const entry = servers.get(server);
      if (entry) entry.status = { status: connected ? "connected" : "failed" };
    }),
    list: vi.fn(async () => ({ data: [...servers.values()] })),
    remove: vi.fn(async ({ server }: { server: string }) => {
      servers.delete(server);
    }),
  };
  return {
    token: "abcdefgh" + "x".repeat(56),
    mcp,
    client: { mcp } as unknown as OpenCodeClient,
  };
}

const signal = new AbortController().signal;

describe("OpenCode phone tool registration", () => {
  it("registers under one stable name and verifies discovery", async () => {
    const { client, token, mcp } = setup();
    const remove = await attachOpenCodePhoneTools({
      client,
      token,
      url: "http://127.0.0.1:43877/mcp",
      directory: "/project/chat",
      signal,
    });
    expect(mcp.add).toHaveBeenCalledWith(
      expect.objectContaining({
        server: PHONE_TOOLS_SERVER,
        location: { directory: "/project/chat" },
        config: expect.objectContaining({
          codemode: false,
          oauth: false,
          protocol: "legacy",
        }),
      }),
      { signal },
    );
    await remove();
    expect(mcp.remove).toHaveBeenCalledWith(
      { server: PHONE_TOOLS_SERVER, location: { directory: "/project/chat" } },
      expect.anything(),
    );
  });

  it("does not rewrite an entry it already attached at the same address", async () => {
    const { client, token, mcp } = setup();
    const input = {
      client,
      token,
      url: "http://192.168.1.5:43877/mcp",
      directory: "/project/chat",
      signal,
    };
    await attachOpenCodePhoneTools(input);
    await attachOpenCodePhoneTools(input);
    expect(mcp.add).toHaveBeenCalledOnce();
  });

  it("replaces a stale entry when the phone address changes", async () => {
    const { client, token, mcp } = setup();
    await attachOpenCodePhoneTools({
      client,
      token,
      url: "http://192.168.1.5:43877/mcp",
      directory: "/project/chat",
      signal,
    });
    await attachOpenCodePhoneTools({
      client,
      token,
      url: "http://100.101.102.103:43877/mcp",
      directory: "/project/chat",
      signal,
    });
    expect(mcp.add).toHaveBeenCalledTimes(2);
    expect(mcp.add.mock.calls.at(-1)?.[0]).toMatchObject({
      config: { url: "http://100.101.102.103:43877/mcp" },
    });
  });

  it("sweeps server names left by the old per-session scheme", async () => {
    const { client, token, mcp } = setup({
      initial: [
        {
          name: "mobile_agent_phone_abcdefgh",
          status: { status: "connected" },
        },
      ],
    });
    await attachOpenCodePhoneTools({
      client,
      token,
      url: "http://127.0.0.1:43877/mcp",
      signal,
    });
    expect(mcp.remove).toHaveBeenCalledWith(
      { server: "mobile_agent_phone_abcdefgh", location: undefined },
      expect.anything(),
    );
  });

  it("does not report success just because the connect endpoint returned HTTP 204", async () => {
    const { client, token, mcp } = setup({ connected: false });
    await expect(
      attachOpenCodePhoneTools({
        client,
        token,
        url: "http://127.0.0.1:43877/mcp",
        signal,
      }),
    ).rejects.toThrow("did not connect");
    expect(mcp.remove).toHaveBeenCalledOnce();
  });
});
