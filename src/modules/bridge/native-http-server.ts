import { Platform } from "react-native";
import { createHttpRequestDecoder } from "./http-framing";

export const PHONE_BRIDGE_PORT = 43877;

type PhoneBridgeListener = { url: string; close: () => Promise<void> };
type ListenerRegistry = {
  current: PhoneBridgeListener | null;
  pending: Promise<void>;
};
const registryKey = Symbol.for("mobile-agent.phone-bridge.listener");
const globalRegistry = globalThis as typeof globalThis & {
  [registryKey]?: ListenerRegistry;
};
const registry = (globalRegistry[registryKey] ??= {
  current: null,
  pending: Promise.resolve(),
});

function isAddressInUse(cause: unknown) {
  return /EADDRINUSE|Address already in use/i.test(String(cause));
}

/** Loopback only. Remote hosts must use an explicitly configured secure tunnel. */
async function bindPhoneBridgeListener(
  handle: (request: Request) => Promise<Response>,
  port: number,
): Promise<PhoneBridgeListener> {
  if (Platform.OS === "web")
    throw new Error("Phone tool hosting requires a native app.");
  const { default: TcpSocket } = await import("react-native-tcp-socket");
  const sockets = new Set<ReturnType<typeof TcpSocket.createConnection>>();
  let closed = false;
  const server = TcpSocket.createServer((socket) => {
    if (closed || sockets.size >= 8) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const decode = createHttpRequestDecoder();
    let handling = false;
    const timeout = setTimeout(() => {
      if (!handling) socket.destroy();
    }, 10000);
    const respond = async (response: Response) => {
      const body = new Uint8Array(await response.arrayBuffer());
      if (socket.destroyed) return;
      const allowedHeaders = ["content-type", "mcp-session-id", "allow"];
      let head = `HTTP/1.1 ${response.status} ${response.status >= 400 ? "Error" : "OK"}\r\n`;
      for (const name of allowedHeaders) {
        const value = response.headers.get(name);
        if (value) head += `${name}: ${value}\r\n`;
      }
      head += `Content-Length: ${body.length}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`;
      socket.write(head);
      socket.write(body);
      socket.end();
    };
    socket.on("data", (data) => {
      if (handling) return;
      try {
        if (typeof data === "string")
          throw new Error("Binary framing required.");
        const parsed = decode(data);
        if (!parsed) return;
        handling = true;
        clearTimeout(timeout);
        const host = parsed.headers.host;
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
          void respond(new Response(null, { status: 403 }));
          return;
        }
        const request = new Request(`http://${host}${parsed.target}`, {
          method: parsed.method,
          headers: parsed.headers,
          body:
            parsed.method === "POST"
              ? new TextDecoder("utf-8", { fatal: true }).decode(parsed.body)
              : undefined,
        });
        void handle(request)
          .then(respond)
          .catch(() => {
            void respond(new Response(null, { status: 500 })).catch(() =>
              socket.destroy(),
            );
          });
      } catch {
        handling = true;
        clearTimeout(timeout);
        void respond(new Response(null, { status: 400 })).catch(() =>
          socket.destroy(),
        );
      }
    });
    socket.on("error", () => {
      socket.destroy();
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", () => {
    for (const socket of sockets) socket.destroy();
  });
  const address = server.address();
  if (!address?.port) {
    server.close();
    throw new Error("Phone bridge did not receive a port.");
  }
  let closing: Promise<void> | null = null;
  const listener: PhoneBridgeListener = {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close() {
      if (closing) return closing;
      closed = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      if (registry.current === listener) registry.current = null;
      closing = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      return closing;
    },
  };
  return listener;
}

/** Reclaim listeners owned by this JS runtime across Fast Refresh/remounts. */
export function startPhoneBridgeListener(
  handle: (request: Request) => Promise<Response>,
): Promise<PhoneBridgeListener> {
  const opening = registry.pending.then(async () => {
    await registry.current?.close();
    let listener: PhoneBridgeListener;
    try {
      listener = await bindPhoneBridgeListener(handle, PHONE_BRIDGE_PORT);
    } catch (cause) {
      // A native listener can outlive a full JS reload. Do not kill an unknown
      // socket or assume the fixed port is ours: ask the OS for an unused port.
      if (!isAddressInUse(cause)) throw cause;
      listener = await bindPhoneBridgeListener(handle, 0);
    }
    registry.current = listener;
    return listener;
  });
  registry.pending = opening.then(
    () => {},
    () => {},
  );
  return opening;
}
