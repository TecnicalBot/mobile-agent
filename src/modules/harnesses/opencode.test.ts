import { describe, expect, it, vi } from "vitest";
import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client";

import {
  makeOpenCodeClient,
  normalizeOpenCodeUrl,
  openCodeMessageText,
  parseOpenCodePairingLink,
  readOpenCodeSnapshot,
} from "./opencode";

describe("OpenCode pairing", () => {
  it("extracts the server and code, preserving reverse proxy prefixes", () => {
    expect(
      parseOpenCodePairingLink(
        "https://agent.example/prefix/auth/connect/abc_123-X",
      ),
    ).toEqual({ url: "https://agent.example/prefix", code: "abc_123-X" });
  });

  it.each([
    "https://agent.example/other/code",
    "https://agent.example/auth/connect/abc?redirect=evil",
    "https://user:secret@agent.example/auth/connect/abc",
    "http://192.168.1.2/auth/connect/abc",
    "https://agent.example/auth/connect/abc/extra",
    "https://agent.example/auth/connect/abc%2Fdef",
  ])("rejects unsafe or unrelated links: %s", (link) => {
    expect(() => parseOpenCodePairingLink(link)).toThrow();
  });

  it("redeems a code without existing server credentials", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ token: "paired-session" }),
    );
    const client = makeOpenCodeClient(
      {
        url: "https://agent.example",
        username: "",
        password: "",
        directory: "",
      },
      transport,
    );
    expect(await client.server.connect({ code: "abc" })).toEqual({
      token: "paired-session",
    });
    expect(String(transport.mock.calls[0][0])).toBe(
      "https://agent.example/auth/connect/abc",
    );
    expect(
      new Headers(transport.mock.calls[0][1]?.headers).has("authorization"),
    ).toBe(false);
  });
});

describe("OpenCode connection security", () => {
  it("allows private LAN HTTP only when enabled by the connection flow", () => {
    expect(
      normalizeOpenCodeUrl("http://192.168.1.20:4096", {
        allowInsecureLan: true,
      }),
    ).toBe("http://192.168.1.20:4096");
    expect(() =>
      normalizeOpenCodeUrl("http://public.example", { allowInsecureLan: true }),
    ).toThrow();
    expect(() =>
      normalizeOpenCodeUrl("http://0.0.0.0:4096", { allowInsecureLan: true }),
    ).toThrow();
  });

  it("lets the UI correct a scanned localhost advertisement without losing its code", () => {
    expect(
      parseOpenCodePairingLink("http://127.0.0.0:4096/auth/connect/secret", {
        allowAddressOverride: true,
      }),
    ).toEqual({ url: "http://127.0.0.0:4096", code: "secret" });
  });
  it.each([
    "http://127.0.0.1:4096",
    "http://localhost:4096",
    "http://[::1]:4096",
    "https://agent.example/prefix",
  ])("accepts %s", (url) => {
    expect(normalizeOpenCodeUrl(`${url}/`)).toBe(url);
  });

  it.each([
    "http://192.168.1.10:4096",
    "http://agent.example",
    "ftp://localhost",
    "https://user:secret@agent.example",
    "https://agent.example?token=secret",
    "https://agent.example#token",
    "http://localhost.evil.example",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => normalizeOpenCodeUrl(url)).toThrow();
  });

  it("uses the official V2 client, authenticates, and refuses redirects", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        version: "2.2.0",
        pid: 1,
        urls: [],
        paths: { tmp: "/tmp" },
      }),
    );
    const client = makeOpenCodeClient(
      {
        url: "https://agent.example",
        username: "opencode",
        password: "secret",
        directory: "",
      },
      transport,
    );
    expect((await client.server.info()).version).toBe("2.2.0");
    const [input, options] = transport.mock.calls[0];
    expect(String(input)).toBe("https://agent.example/api/info");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Basic ${btoa("opencode:secret")}`,
    );
    expect(options?.redirect).toBe("error");
  });

  it("does not add an authorization header for a passwordless local server", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        version: "2.2.0",
        pid: 1,
        urls: [],
        paths: { tmp: "/tmp" },
      }),
    );
    await makeOpenCodeClient(
      {
        url: "http://localhost:4096",
        username: "",
        password: "",
        directory: "",
      },
      transport,
    ).server.info();
    expect(
      new Headers(transport.mock.calls[0][1]?.headers).has("authorization"),
    ).toBe(false);
  });
});

describe("OpenCode snapshots", () => {
  it("restores chronological messages, requests, active status, and history cursor without mutations", async () => {
    const client = {
      message: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: "new" }, { id: "old" }],
          cursor: { next: "older" },
        }),
      },
      permission: { list: vi.fn().mockResolvedValue([{ id: "permission" }]) },
      session: {
        form: { list: vi.fn().mockResolvedValue([{ id: "question" }]) },
        active: vi.fn().mockResolvedValue({ ses_test: { type: "running" } }),
        get: vi.fn().mockResolvedValue({ id: "ses_test" }),
      },
    };
    const signal = new AbortController().signal;
    const result = await readOpenCodeSnapshot(
      client as unknown as OpenCodeClient,
      "ses_test",
      signal,
    );
    expect(result.messages.map((message) => message.id)).toEqual([
      "old",
      "new",
    ]);
    expect(result.running).toBe(true);
    expect(result.olderCursor).toBe("older");
    expect(result.permissions).toEqual([{ id: "permission" }]);
    expect(result.forms).toEqual([{ id: "question" }]);
    expect(client.message.list).toHaveBeenCalledWith(
      { sessionID: "ses_test", limit: 100, order: "desc" },
      { signal },
    );
  });
});

describe("OpenCode message presentation", () => {
  it("renders user text", () => {
    expect(
      openCodeMessageText({
        id: "msg_1",
        type: "user",
        text: "Hello",
        time: { created: 1 },
      }),
    ).toBe("Hello");
  });

  it("renders assistant text and tool output without executing tools locally", () => {
    const message = {
      id: "msg_2",
      type: "assistant",
      time: { created: 1 },
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [
        { type: "text", text: "Done" },
        {
          type: "tool",
          id: "tool_1",
          name: "shell",
          time: { created: 1 },
          state: {
            status: "completed",
            input: {},
            content: [{ type: "text", text: "OK" }],
          },
        },
      ],
    } as SessionMessageInfo;
    expect(openCodeMessageText(message)).toBe("Done\n\nshell · completed\nOK");
  });
});
