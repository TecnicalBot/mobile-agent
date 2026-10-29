import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeSocket = EventEmitter & {
  destroyed: boolean;
  written: string;
  remoteAddress: string;
  write: (chunk: string | Uint8Array) => boolean;
  end: (chunk?: string | Uint8Array) => void;
  destroy: () => void;
};

const network = vi.hoisted(() => ({
  fixedPortBusy: false,
  nextPort: 50000,
  hosts: [] as string[],
  servers: [] as { port: number; closed: boolean }[],
  connect: null as null | ((socket: unknown) => void),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-tcp-socket", async () => {
  const { EventEmitter: NodeEmitter } = await import("node:events");
  return {
    default: {
      createServer: (listener: (socket: unknown) => void) => {
        network.connect = listener;
        const state = { port: 0, closed: false };
        network.servers.push(state);
        const server = new NodeEmitter() as InstanceType<typeof NodeEmitter> & {
          listen: (
            options: { host: string; port: number },
            callback: () => void,
          ) => void;
          address: () => { port: number };
          close: (callback?: () => void) => void;
        };
        server.listen = (options, callback) => {
          network.hosts.push(options.host);
          queueMicrotask(() => {
            if (options.port === 43877 && network.fixedPortBusy)
              server.emit(
                "error",
                "bind failed: EADDRINUSE (Address already in use)",
              );
            else {
              state.port = options.port || network.nextPort++;
              callback();
            }
          });
        };
        server.address = () => ({ port: state.port });
        server.close = (callback) => {
          queueMicrotask(() => {
            state.closed = true;
            callback?.();
          });
        };
        return server;
      },
    },
  };
});

const token = "a".repeat(64);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
  network.fixedPortBusy = false;
  network.servers.length = 0;
  network.hosts.length = 0;
  network.connect = null;
});

function fakeSocket(remoteAddress: string): FakeSocket {
  const socket = new EventEmitter() as FakeSocket;
  socket.destroyed = false;
  socket.written = "";
  socket.remoteAddress = remoteAddress;
  socket.write = (chunk) => {
    socket.written +=
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  };
  socket.end = (chunk) => {
    if (chunk !== undefined) socket.write(chunk);
    socket.destroyed = true;
    socket.emit("close");
  };
  socket.destroy = () => {
    socket.destroyed = true;
    socket.emit("close");
  };
  return socket;
}

function request(host: string, extra = "") {
  return new TextEncoder().encode(
    `POST /mcp HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer ${token}\r\nContent-Length: 2\r\n${extra}\r\n{}`,
  );
}

async function settle(socket: FakeSocket) {
  for (let attempt = 0; attempt < 50 && !socket.written; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  return socket.written;
}

describe("phone bridge listener lifecycle", () => {
  it("uses an OS-assigned port if a stale native listener owns the preferred port", async () => {
    network.fixedPortBusy = true;
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const listener = await startPhoneBridgeListener(
      async () => new Response(null),
    );
    cleanups.push(listener.close);
    expect(listener.url).toMatch(/^http:\/\/127\.0\.0\.1:5\d+\/mcp$/);
    expect(listener.reach).toBe("loopback");
    expect(network.servers.at(-1)?.port).not.toBe(43877);
  });

  it("closes its previous listener before opening a replacement", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const first = await startPhoneBridgeListener(
      async () => new Response(null),
    );
    const previous = network.servers.at(-1)!;
    const second = await startPhoneBridgeListener(
      async () => new Response(null),
    );
    cleanups.push(first.close, second.close);
    expect(previous.closed).toBe(true);
    expect(second.url).toBe("http://127.0.0.1:43877/mcp");
  });

  it("preserves listener ownership across module refreshes", async () => {
    const firstModule = await import("./native-http-server");
    const first = await firstModule.startPhoneBridgeListener(
      async () => new Response(null),
    );
    const previous = network.servers.at(-1)!;
    vi.resetModules();
    const nextModule = await import("./native-http-server");
    const second = await nextModule.startPhoneBridgeListener(
      async () => new Response(null),
    );
    cleanups.push(first.close, second.close);
    expect(previous.closed).toBe(true);
  });

  it("serializes competing starts and makes close idempotent", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const listeners = await Promise.all([
      startPhoneBridgeListener(async () => new Response(null)),
      startPhoneBridgeListener(async () => new Response(null)),
    ]);
    cleanups.push(...listeners.map((listener) => listener.close));
    expect(network.servers.filter((server) => !server.closed)).toHaveLength(1);
    await listeners[1].close();
    await listeners[1].close();
    expect(network.servers.every((server) => server.closed)).toBe(true);
  });
});

describe("phone bridge network exposure", () => {
  it("binds all interfaces and advertises the chosen address for a LAN reach", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const listener = await startPhoneBridgeListener(
      async () => new Response(null),
      { reach: "lan", address: "192.168.1.5" },
    );
    cleanups.push(listener.close);
    expect(network.hosts.at(-1)).toBe("0.0.0.0");
    expect(listener.url).toBe("http://192.168.1.5:43877/mcp");
    expect(listener.reach).toBe("lan");
  });

  it("refuses a network reach without an advertised address", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    await expect(
      startPhoneBridgeListener(async () => new Response(null), {
        reach: "lan",
      }),
    ).rejects.toThrow("address");
  });

  it("accepts a private source and answers the request", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const handle = vi.fn(async () => new Response("ok"));
    const listener = await startPhoneBridgeListener(handle, {
      reach: "lan",
      address: "192.168.1.5",
    });
    cleanups.push(listener.close);
    const socket = fakeSocket("192.168.1.20");
    network.connect!(socket);
    socket.emit("data", request("192.168.1.5:43877"));
    expect(await settle(socket)).toContain("HTTP/1.1 200 OK");
    expect(handle).toHaveBeenCalledOnce();
  });

  it("flushes a complete UTF-8 response before closing the native socket", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const listener = await startPhoneBridgeListener(
      async () => new Response("你好: MCP response"),
      { reach: "lan", address: "192.168.1.5" },
    );
    cleanups.push(listener.close);
    const socket = fakeSocket("192.168.1.20");
    // Model native scheduling: bare writes are queued elsewhere and destroyed
    // by end(), but end(packet) closes only after the packet's write callback.
    const end = socket.end;
    socket.write = vi.fn(() => true);
    socket.end = vi.fn((packet) => {
      if (packet !== undefined) {
        socket.written = new TextDecoder().decode(packet as Uint8Array);
      }
      end();
    });
    network.connect!(socket);
    socket.emit("data", request("192.168.1.5:43877"));
    const response = await settle(socket);
    expect(response).toContain("你好: MCP response");
    expect(response).toContain(
      `Content-Length: ${new TextEncoder().encode("你好: MCP response").length}\r\n`,
    );
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.end).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it("rejects a public source even when the socket is bound to all interfaces", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const handle = vi.fn(async () => new Response("ok"));
    const listener = await startPhoneBridgeListener(handle, {
      reach: "lan",
      address: "192.168.1.5",
    });
    cleanups.push(listener.close);
    const socket = fakeSocket("203.0.113.9");
    network.connect!(socket);
    socket.emit("data", request("192.168.1.5:43877"));
    expect(await settle(socket)).toContain("HTTP/1.1 403");
    expect(handle).not.toHaveBeenCalled();
  });

  it("only accepts tailnet and loopback sources in tailnet mode", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const handle = vi.fn(async () => new Response("ok"));
    const listener = await startPhoneBridgeListener(handle, {
      reach: "tailnet",
      address: "100.101.102.103",
    });
    cleanups.push(listener.close);
    const lanSocket = fakeSocket("192.168.1.20");
    network.connect!(lanSocket);
    lanSocket.emit("data", request("100.101.102.103:43877"));
    expect(await settle(lanSocket)).toContain("HTTP/1.1 403");
    expect(handle).not.toHaveBeenCalled();

    const tailnetSocket = fakeSocket("100.88.1.2");
    network.connect!(tailnetSocket);
    tailnetSocket.emit("data", request("100.101.102.103:43877"));
    expect(await settle(tailnetSocket)).toContain("HTTP/1.1 200 OK");
    expect(handle).toHaveBeenCalledOnce();
  });

  it("rejects a DNS-name Host header to block rebinding", async () => {
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const handle = vi.fn(async () => new Response("ok"));
    const listener = await startPhoneBridgeListener(handle, {
      reach: "lan",
      address: "192.168.1.5",
    });
    cleanups.push(listener.close);
    const socket = fakeSocket("192.168.1.20");
    network.connect!(socket);
    socket.emit("data", request("attacker.example:43877"));
    expect(await settle(socket)).toContain("HTTP/1.1 403");
    expect(handle).not.toHaveBeenCalled();
  });
});
