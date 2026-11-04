import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  prepareLocalCallbackSession,
  stopLocalCallbackServer,
} from "@/core/services/local-server";

const mocks = vi.hoisted(() => ({ createServer: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-tcp-socket", () => ({
  default: { createServer: mocks.createServer },
}));

class Server extends EventEmitter {
  connection: (socket: EventEmitter) => void;
  listen = vi.fn((_options: unknown, ready: () => void) => {
    ready();
  });
  close = vi.fn();

  constructor(connection: (socket: EventEmitter) => void) {
    super();
    this.connection = connection;
  }
}

beforeEach(() => {
  mocks.createServer.mockReset();
  mocks.createServer.mockImplementation((connection) => new Server(connection));
});

afterEach(() => {
  stopLocalCallbackServer();
  vi.restoreAllMocks();
});

describe("provider OAuth callback server", () => {
  it("keeps the new callback and port when replacing another provider's listener", async () => {
    const previousCallback = vi.fn();
    await prepareLocalCallbackSession({
      expectedState: "old",
      onCallback: previousCallback,
    });
    const previousServer: Server = mocks.createServer.mock.results[0].value;
    const onCallback = vi.fn();
    await prepareLocalCallbackSession({
      expectedState: "new",
      host: "127.0.0.1",
      port: 1456,
      path: "/auth/openrouter/callback",
      onCallback,
    });
    const server: Server = mocks.createServer.mock.results[1].value;
    expect(previousServer.close).toHaveBeenCalledOnce();
    expect(server.listen).toHaveBeenCalledWith(
      { host: "127.0.0.1", port: 1456 },
      expect.any(Function),
    );

    const socket = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
    });
    server.connection(socket);
    socket.emit(
      "data",
      Buffer.from(
        "GET /auth/openrouter/callback?code=issued&state=new HTTP/1.1\r\n\r\n",
      ),
    );
    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledOnce());
    expect(onCallback.mock.calls[0][0]).toMatchObject({
      code: "issued",
      state: "new",
    });
    expect(previousCallback).not.toHaveBeenCalled();
  });

  it("rejects bind errors so sign-in does not wait for an unreachable callback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("EADDRINUSE");
    mocks.createServer.mockImplementation((connection) => {
      const server = new Server(connection);
      server.listen.mockImplementation(() => {
        server.emit("error", error);
      });
      return server;
    });
    await expect(
      prepareLocalCallbackSession({
        expectedState: "state",
        onCallback: vi.fn(),
      }),
    ).rejects.toBe(error);
  });
});
