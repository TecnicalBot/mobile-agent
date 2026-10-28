import { afterEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({
  fixedPortBusy: false,
  nextPort: 50000,
  servers: [] as { port: number; closed: boolean }[],
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-tcp-socket", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: {
      createServer: () => {
        const state = { port: 0, closed: false };
        network.servers.push(state);
        const server = new EventEmitter() as InstanceType<
          typeof EventEmitter
        > & {
          listen: (
            options: { host: string; port: number },
            callback: () => void,
          ) => void;
          address: () => { port: number };
          close: (callback?: () => void) => void;
        };
        server.listen = (options, callback) => {
          expect(options.host).toBe("127.0.0.1");
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

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
  network.fixedPortBusy = false;
  network.servers.length = 0;
});

describe("phone bridge listener lifecycle", () => {
  it("uses an OS-assigned port if a stale native listener owns the preferred port", async () => {
    network.fixedPortBusy = true;
    const { startPhoneBridgeListener } = await import("./native-http-server");
    const listener = await startPhoneBridgeListener(
      async () => new Response(null),
    );
    cleanups.push(listener.close);
    expect(listener.url).toMatch(/^http:\/\/127\.0\.0\.1:5\d+\/mcp$/);
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
