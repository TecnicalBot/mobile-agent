import { describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import { attachOpenCodePhoneTools } from "./opencode-phone-tools";

function setup(connected: boolean) {
  const token = "abcdefgh" + "x".repeat(56);
  const mcp = {
    add: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    list: vi
      .fn()
      .mockResolvedValue({
        data: [
          {
            name: "mobile_agent_phone_abcdefgh",
            status: { status: connected ? "connected" : "failed" },
          },
        ],
      }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { token, mcp, client: { mcp } as unknown as OpenCodeClient };
}

describe("OpenCode phone tool registration", () => {
  it("registers and verifies tools in the chat's workspace with direct discovery", async () => {
    const { client, token, mcp } = setup(true);
    const signal = new AbortController().signal;
    const remove = await attachOpenCodePhoneTools({
      client,
      token,
      url: "http://127.0.0.1:43877/mcp",
      directory: "/project/chat",
      signal,
    });
    expect(mcp.add).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { directory: "/project/chat" },
        config: expect.objectContaining({
          codemode: false,
          oauth: false,
          protocol: "legacy",
        }),
      }),
      { signal },
    );
    expect(mcp.list).toHaveBeenCalledWith(
      { location: { directory: "/project/chat" } },
      { signal },
    );
    await remove();
    expect(mcp.remove).toHaveBeenCalledWith(
      {
        server: "mobile_agent_phone_abcdefgh",
        location: { directory: "/project/chat" },
      },
      expect.anything(),
    );
  });

  it("does not report success just because the connect endpoint returned HTTP 204", async () => {
    const { client, token, mcp } = setup(false);
    await expect(
      attachOpenCodePhoneTools({
        client,
        token,
        url: "http://127.0.0.1:43877/mcp",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("did not connect");
    expect(mcp.remove).toHaveBeenCalledOnce();
  });
});
