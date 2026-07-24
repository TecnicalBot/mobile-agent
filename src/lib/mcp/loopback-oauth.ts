import * as WebBrowser from "expo-web-browser";
import { AppState, Platform, type NativeEventSubscription } from "react-native";

export const MCP_OAUTH_REDIRECT_URI =
  "http://127.0.0.1:2083/mcp/oauth/callback";

const CALLBACK_TIMEOUT_MS = 5 * 60_000;

type CallbackResult = {
  code: string;
  state: string;
};

function canceledError() {
  const error = new Error("MCP OAuth was canceled.");
  error.name = "McpOAuthCanceledError";
  return error;
}

function callbackPage(success: boolean, message: string) {
  const title = success ? "Connected" : "Connection failed";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>${title}</title></head><body style="font-family:system-ui;padding:32px"><h1>${title}</h1><p>${message}</p></body></html>`;
}

function writeResponse(socket: any, status: number, body: string) {
  const statusText = status === 200 ? "OK" : "Bad Request";
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${new TextEncoder().encode(body).length}\r\nConnection: close\r\n\r\n${body}`,
  );
}

export async function openMcpLoopbackAuthorization(
  authorizationUrl: string,
  expectedState: string,
): Promise<CallbackResult> {
  if (Platform.OS === "web") {
    throw new Error("MCP loopback OAuth is not available on web.");
  }

  const TcpSocketModule = await import("react-native-tcp-socket");
  const TcpSocket = TcpSocketModule.default ?? TcpSocketModule;
  let server: any = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let appStateSubscription: NativeEventSubscription | null = null;
  let settled = false;

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    const finish = (
      result: { value: CallbackResult } | { error: Error },
      socket?: any,
    ) => {
      if (settled) return;
      settled = true;

      if ("value" in result) {
        if (socket) {
          writeResponse(
            socket,
            200,
            callbackPage(
              true,
              "You can close this page and return to Mobile Agent.",
            ),
          );
        }
        resolve(result.value);
      } else {
        if (socket) {
          writeResponse(socket, 400, callbackPage(false, result.error.message));
        }
        reject(result.error);
      }
    };

    server = TcpSocket.createServer((socket: any) => {
      socket.once("data", (data: any) => {
        try {
          const requestLine = data.toString("utf8").split("\r\n")[0];
          const requestPath = requestLine?.split(" ")[1];

          if (!requestLine?.startsWith("GET ") || !requestPath) {
            writeResponse(
              socket,
              400,
              callbackPage(false, "Invalid OAuth callback."),
            );
            return;
          }

          const callbackUrl = new URL(requestPath, MCP_OAUTH_REDIRECT_URI);
          if (callbackUrl.pathname !== "/mcp/oauth/callback") {
            writeResponse(
              socket,
              400,
              callbackPage(false, "Unknown callback path."),
            );
            return;
          }

          const returnedState = callbackUrl.searchParams.get("state");
          const oauthError = callbackUrl.searchParams.get("error");
          const errorDescription =
            callbackUrl.searchParams.get("error_description");
          const code = callbackUrl.searchParams.get("code");

          if (returnedState !== expectedState) {
            finish({ error: new Error("MCP OAuth state mismatch.") }, socket);
          } else if (oauthError) {
            finish(
              {
                error: new Error(
                  errorDescription
                    ? `${oauthError}: ${errorDescription}`
                    : oauthError,
                ),
              },
              socket,
            );
          } else if (!code) {
            finish(
              {
                error: new Error(
                  "MCP OAuth did not return an authorization code.",
                ),
              },
              socket,
            );
          } else {
            finish({ value: { code, state: returnedState } }, socket);
          }
        } catch (error) {
          finish(
            {
              error: error instanceof Error ? error : new Error(String(error)),
            },
            socket,
          );
        }
      });
      socket.on("error", () => {});
    });

    server.once("error", (error: unknown) => {
      finish({
        error: new Error(
          `Could not start MCP OAuth callback server: ${String(error)}`,
        ),
      });
    });

    server.listen({ port: 2083, host: "127.0.0.1", reuseAddress: true }, () => {
      timeout = setTimeout(
        () => finish({ error: new Error("MCP OAuth callback timed out.") }),
        CALLBACK_TIMEOUT_MS,
      );

      if (Platform.OS === "android") {
        let appLeftForeground = false;
        appStateSubscription = AppState.addEventListener(
          "change",
          (nextState) => {
            if (nextState !== "active") {
              appLeftForeground = true;
              return;
            }

            if (appLeftForeground && !settled) {
              finish({ error: canceledError() });
            }
          },
        );
      }

      void WebBrowser.openBrowserAsync(authorizationUrl)
        .then((result) => {
          if (
            !settled &&
            (result.type === "cancel" || result.type === "dismiss")
          ) {
            finish({ error: canceledError() });
          }
        })
        .catch((error: unknown) => {
          finish({
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
    });
  });

  try {
    const result = await callbackPromise;
    try {
      await WebBrowser.dismissBrowser();
    } catch {}
    return result;
  } finally {
    (appStateSubscription as NativeEventSubscription | null)?.remove();
    if (timeout) clearTimeout(timeout);
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
