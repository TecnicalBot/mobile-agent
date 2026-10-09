import { Platform } from "react-native";

type CallbackConfig = {
  host: string;
  path: string;
  port: number;
};

export type LocalCallbackParams = {
  code: string | null;
  query: URLSearchParams;
  state: string | null;
};

let activeServer: any = null;
let activeConfig: CallbackConfig | null = null;
let startingServerPromise: Promise<any> | null = null;

let currentOnCallback:
  | ((params: LocalCallbackParams) => Promise<void> | void)
  | null = null;
let currentHandled = false;
let currentConfig: CallbackConfig | null = null;

async function getTcpSocket() {
  if (Platform.OS === "web") {
    throw new Error("Local callback server is not available on web.");
  }

  const TcpSocketModule = await import("react-native-tcp-socket");

  return TcpSocketModule.default ?? TcpSocketModule;
}

function configKey(config: CallbackConfig) {
  return `${config.host}:${config.port}${config.path}`;
}

function utf8ByteLength(value: string) {
  let bytes = 0;

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }

  return bytes;
}

function writeHttpResponse(
  socket: any,
  status: number,
  body: string,
) {
  const statusText = status === 200 ? "OK" : status === 409 ? "Conflict" : "Bad Request";
  const head =
    `HTTP/1.1 ${status} ${statusText}\r\n` +
    "Content-Type: text/html; charset=utf-8\r\n" +
    `Content-Length: ${utf8ByteLength(body)}\r\n` +
    "Connection: close\r\n\r\n";

  try {
    socket.write(head + body);
    socket.end();
  } catch {}
}

function callbackPage(title: string, message: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title></head><body style="font-family: -apple-system, system-ui, sans-serif; padding: 48px; text-align: center; color: #111;"><h2>${title}</h2><p>${message}</p></body></html>`;
}

/**
 * Prepares a one-shot HTTP callback listener and returns the resolved server
 * config (including the bound port). Reuses the running server when the host,
 * port and path match; otherwise replaces it.
 */
export async function prepareLocalCallbackSession(input: {
  expectedState: string;
  onCallback: (params: LocalCallbackParams) => Promise<void> | void;
  host?: string;
  path?: string;
  port?: number;
}) {
  const config: CallbackConfig = {
    host: input.host ?? "localhost",
    path: input.path ?? "/auth/callback",
    port: input.port ?? 1455,
  };

  currentOnCallback = input.onCallback;
  currentHandled = false;
  currentConfig = config;

  if (
    activeServer &&
    activeConfig &&
    configKey(activeConfig) !== configKey(config)
  ) {
    stopLocalCallbackServer();
  }

  await ensureLocalCallbackServer();
  activeConfig = config;

  return config;
}

/**
 * Backwards-compatible wrapper for the legacy Codex browser OAuth flow.
 */
export function prepareOpenAICallbackSession(
  expectedState: string,
  onCode: (code: string, state: string | null) => Promise<void> | void,
) {
  return prepareLocalCallbackSession({
    expectedState,
    host: "localhost",
    path: "/auth/callback",
    port: 1455,
    onCallback: ({ code, state, query }) => onCode(code ?? query.get("code") ?? "", state),
  });
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

  startingServerPromise = startLocalCallbackServer(currentConfig);

  try {
    activeServer = await startingServerPromise;
    return activeServer;
  } finally {
    startingServerPromise = null;
  }
}

async function startLocalCallbackServer(config: CallbackConfig | null) {
  const TcpSocket = await getTcpSocket();
  const effective = config ?? { host: "localhost", path: "/auth/callback", port: 1455 };

  const server = TcpSocket.createServer((socket: any) => {
    socket.once("data", (data: any) => {
      const request = data.toString("utf8");
      const firstLine = request.split("\r\n")[0];

      if (!firstLine || !firstLine.startsWith("GET ")) {
        return;
      }

      const rawPath = firstLine.split(" ")[1];

      if (!rawPath) {
        return;
      }

      let url: URL;

      try {
        url = new URL(rawPath, `http://${effective.host}:${effective.port}`);
      } catch {
        return;
      }

      if (url.pathname !== effective.path) {
        writeHttpResponse(socket, 400, callbackPage("Not found", "Unexpected callback path."));
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error =
        url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (!code && !error) {
        writeHttpResponse(socket, 400, callbackPage("Missing code", "The authorization code was missing."));
        return;
      }

      if (currentHandled) {
        writeHttpResponse(socket, 409, callbackPage("Already received", "This sign-in callback was already handled."));
        return;
      }

      currentHandled = true;
      const callback = currentOnCallback;

      void Promise.resolve()
        .then(async () => {
          await callback?.({ code, query: url.searchParams, state: returnedState });
          writeHttpResponse(
            socket,
            200,
            callbackPage("Connected", "You can return to the app."),
          );
        })
        .catch((errorValue) => {
          writeHttpResponse(
            socket,
            400,
            callbackPage(
              "Sign-in failed",
              errorValue instanceof Error ? errorValue.message : "Please try again.",
            ),
          );
        });
    });

    socket.on("error", () => {});
  });

  server.on("error", (error: any) => {
    console.warn("Local callback server error:", error);
  });

  server.listen({ port: effective.port, host: effective.host });

  return server;
}

export function stopLocalCallbackServer() {
  if (!activeServer) return;

  try {
    activeServer.close();
  } catch {}

  activeServer = null;
  activeConfig = null;
  startingServerPromise = null;
  currentOnCallback = null;
  currentHandled = false;
  currentConfig = null;
}
