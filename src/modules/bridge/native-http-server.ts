import { Platform } from "react-native";
import { createHttpRequestDecoder } from "./http-framing";

export const PHONE_BRIDGE_PORT = 43877;

/** Loopback only. Remote hosts must use an explicitly configured secure tunnel. */
export async function startPhoneBridgeListener(
  handle: (request: Request) => Promise<Response>,
) {
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
    server.listen({ host: "127.0.0.1", port: PHONE_BRIDGE_PORT }, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", () => {
    for (const socket of sockets) socket.destroy();
  });
  return {
    url: `http://127.0.0.1:${PHONE_BRIDGE_PORT}/mcp`,
    close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      server.close();
    },
  };
}
