import { Platform } from "react-native";
import { createHttpRequestDecoder } from "./http-framing";
import {
  isAllowedBridgeHost,
  isAllowedBridgeSource,
  type BridgeReach,
} from "./reach";

export const PHONE_BRIDGE_PORT = 43877;

type PhoneBridgeListener = {
  url: string;
  reach: BridgeReach;
  port: number;
  close: () => Promise<void>;
};

export type PhoneBridgeListenerOptions = {
  reach?: BridgeReach;
  /** Interface address to advertise. Required for anything but loopback. */
  address?: string;
  port?: number;
};

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

const AUTH_FAILURE_LIMIT = 20;
const AUTH_FAILURE_WINDOW_MS = 60_000;

function isAddressInUse(cause: unknown) {
  return /EADDRINUSE|Address already in use/i.test(String(cause));
}

function normalizeSource(address: string | undefined) {
  return (address ?? "").split("%")[0].replace(/^::ffff:/, "");
}

/** Loopback only. Remote hosts must use an explicitly configured secure tunnel. */
async function bindPhoneBridgeListener(
  handle: (request: Request) => Promise<Response>,
  options: Required<Pick<PhoneBridgeListenerOptions, "reach" | "port">> & {
    address?: string;
  },
): Promise<PhoneBridgeListener> {
  if (Platform.OS === "web")
    throw new Error("Phone tool hosting requires a native app.");
  const { reach, port } = options;
  if (reach !== "loopback" && !options.address)
    throw new Error("A network reach needs an address to advertise.");
  const bindHost = reach === "loopback" ? "127.0.0.1" : "0.0.0.0";
  const { default: TcpSocket } = await import("react-native-tcp-socket");
  const sockets = new Set<ReturnType<typeof TcpSocket.createConnection>>();
  const failures = new Map<string, { count: number; resetAt: number }>();
  let closed = false;

  function isThrottled(source: string) {
    const entry = failures.get(source);
    if (!entry) return false;
    if (entry.resetAt <= Date.now()) {
      failures.delete(source);
      return false;
    }
    return entry.count >= AUTH_FAILURE_LIMIT;
  }

  function recordFailure(source: string) {
    const now = Date.now();
    const entry = failures.get(source);
    if (!entry || entry.resetAt <= now) {
      failures.set(source, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

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
        const source = normalizeSource(socket.remoteAddress);
        if (!isAllowedBridgeSource(reach, source)) {
          void respond(new Response(null, { status: 403 }));
          return;
        }
        if (isThrottled(source)) {
          void respond(new Response(null, { status: 429 }));
          return;
        }
        const host = parsed.headers.host;
        const hostname = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host)?.[1] ?? "";
        if (!isAllowedBridgeHost(hostname)) {
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
          .then((response) => {
            if (response.status === 401) recordFailure(source);
            return respond(response);
          })
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
    server.listen({ host: bindHost, port }, () => {
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
  const advertised = reach === "loopback" ? "127.0.0.1" : options.address!;
  let closing: Promise<void> | null = null;
  const listener: PhoneBridgeListener = {
    url: `http://${advertised}:${address.port}/mcp`,
    reach,
    port: address.port,
    close() {
      if (closing) return closing;
      closed = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      failures.clear();
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
  options: PhoneBridgeListenerOptions = {},
): Promise<PhoneBridgeListener> {
  const reach = options.reach ?? "loopback";
  const port = options.port ?? PHONE_BRIDGE_PORT;
  const opening = registry.pending.then(async () => {
    await registry.current?.close();
    let listener: PhoneBridgeListener;
    try {
      listener = await bindPhoneBridgeListener(handle, {
        reach,
        port,
        address: options.address,
      });
    } catch (cause) {
      // A native listener can outlive a full JS reload. Do not kill an unknown
      // socket or assume the fixed port is ours: ask the OS for an unused port.
      if (!isAddressInUse(cause)) throw cause;
      listener = await bindPhoneBridgeListener(handle, {
        reach,
        port: 0,
        address: options.address,
      });
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
