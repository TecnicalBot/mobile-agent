import { Platform } from "react-native";

let activeServer: any = null;
let startingServerPromise: Promise<any> | null = null;

let currentExpectedState: string | null = null;
let currentOnCode:
  | ((code: string, state: string | null) => Promise<void> | void)
  | null = null;
let currentHandled = false;

async function getTcpSocket() {
  if (Platform.OS === "web") {
    throw new Error("Local callback server is not available on web.");
  }

  const TcpSocketModule = await import("react-native-tcp-socket");

  return TcpSocketModule.default ?? TcpSocketModule;
}

export function prepareOpenAICallbackSession(
  expectedState: string,
  onCode: (code: string, state: string | null) => Promise<void> | void,
) {
  currentExpectedState = expectedState;
  currentOnCode = onCode;
  currentHandled = false;

  return ensureLocalCallbackServer();
}

export async function ensureLocalCallbackServer() {
  if (Platform.OS === "web") {
    return null;
  }

  if (activeServer) {
    return activeServer;
  }

  if (startingServerPromise) {
    return startingServerPromise;
  }

  startingServerPromise = startLocalCallbackServer();

  try {
    activeServer = await startingServerPromise;
    return activeServer;
  } finally {
    startingServerPromise = null;
  }
}

async function startLocalCallbackServer() {
  const TcpSocket = await getTcpSocket();

  const server = TcpSocket.createServer((socket: any) => {
    socket.once("data", (data: any) => {
      const request = data.toString("utf8");
      const firstLine = request.split("\r\n")[0];

      if (!firstLine.startsWith("GET ")) {
        return;
      }

      const path = firstLine.split(" ")[1];

      if (!path || !path.startsWith("/auth/callback")) {
        return;
      }

      const url = new URL(path, "http://localhost:1455");

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (!code) {
        return;
      }

      if (!currentExpectedState || returnedState !== currentExpectedState) {
        return;
      }

      if (currentHandled) {
        return;
      }

      currentHandled = true;

      const callback = currentOnCode;

      void Promise.resolve()
        .then(async () => {
          await callback?.(code, returnedState);
        })
        .catch(() => {});
    });

    socket.on("error", () => {});
  });

  server.on("error", (error: any) => {
    if (String(error).includes("EADDRINUSE")) {
      if (activeServer === server) {
        activeServer = null;
      }
      return;
    }
  });

  server.listen({ port: 1455, host: "localhost" });

  return server;
}

export function stopLocalCallbackServer() {
  if (!activeServer) return;

  try {
    activeServer.close();
  } catch {}

  activeServer = null;
  startingServerPromise = null;
  currentExpectedState = null;
  currentOnCode = null;
  currentHandled = false;
}
