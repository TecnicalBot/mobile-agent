import {
  OpenCode,
  type OpenCodeClient,
  type SessionMessageInfo,
} from "@opencode/client";

export type OpenCodeConnection = {
  url: string;
  username: string;
  password: string;
  directory: string;
  allowInsecureLan?: boolean;
};

/** A scanned link is untrusted input: only accept OpenCode's exact pairing path. */
export function parseOpenCodePairingLink(
  value: string,
  options?: { allowAddressOverride?: boolean },
): {
  url: string;
  code: string;
} {
  const link = new URL(value.trim());
  if (link.username || link.password || link.search || link.hash)
    throw new Error("Invalid pairing link.");
  const match = /^(.*)\/auth\/connect\/([A-Za-z0-9_-]+)\/?$/.exec(
    link.pathname,
  );
  if (!match)
    throw new Error(
      "Scan an OpenCode pairing QR code or paste its pairing link.",
    );
  if (!["http:", "https:"].includes(link.protocol))
    throw new Error("Unsupported pairing URL.");
  return {
    // Scanning alone never sends a request. An unreachable advertised address can
    // be corrected explicitly, then the final endpoint is validated before use.
    url: options?.allowAddressOverride
      ? `${link.origin}${match[1]}`
      : normalizeOpenCodeUrl(`${link.origin}${match[1]}`),
    code: match[2],
  };
}

function isPrivateAddress(host: string) {
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  return /^\[f[cd][0-9a-f]{2}:/i.test(host);
}

/** Plain LAN HTTP requires explicit consent. Public cleartext endpoints stay blocked. */
export function normalizeOpenCodeUrl(
  value: string,
  options?: { allowInsecureLan?: boolean },
): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Use a server URL without credentials, query parameters, or fragments.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]")
    throw new Error(
      "Use your desktop's LAN address, not its wildcard listening address.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (local || (options?.allowInsecureLan && isPrivateAddress(url.hostname)))
    )
  ) {
    throw new Error(
      "Use HTTPS for remote servers, or HTTP on localhost through Termux or a secure tunnel.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function makeOpenCodeClient(
  connection: OpenCodeConnection,
  transport: typeof globalThis.fetch,
): OpenCodeClient {
  const baseUrl = normalizeOpenCodeUrl(connection.url, connection);
  return OpenCode.make({
    baseUrl,
    headers: connection.password
      ? {
          Authorization: `Basic ${btoa(`${connection.username || "opencode"}:${connection.password}`)}`,
        }
      : undefined,
    fetch: (input, init) => transport(input, { ...init, redirect: "error" }),
  });
}

export function openCodeMessageText(message: SessionMessageInfo): string {
  if (message.type === "user") return message.text;
  if (message.type !== "assistant") return "";
  return (
    message.content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "reasoning") return `Thinking: ${part.text}`;
        const state = part.state;
        const output =
          "content" in state
            ? state.content
                ?.map((item) => (item.type === "text" ? item.text : "[File]"))
                .join("\n")
            : undefined;
        return `${part.name} · ${state.status}${output ? `\n${output}` : ""}${"error" in state ? `\n${JSON.stringify(state.error)}` : ""}`;
      })
      .join("\n\n") +
    (message.error ? `\n${JSON.stringify(message.error)}` : "")
  );
}

export type OpenCodeSnapshot = Awaited<ReturnType<typeof readOpenCodeSnapshot>>;

/** Snapshot reads are safe to retry; prompts and permission replies are not. */
export async function readOpenCodeSnapshot(
  client: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
) {
  const options = { signal };
  const [messages, permissions, forms, active, session] = await Promise.all([
    client.message.list({ sessionID, limit: 100, order: "desc" }, options),
    client.permission.list({ sessionID }, options),
    client.session.form.list({ sessionID }, options),
    client.session.active(options),
    client.session.get({ sessionID }, options),
  ]);
  return {
    messages: [...messages.data].reverse(),
    olderCursor: messages.cursor.next ?? null,
    permissions,
    forms,
    running: Boolean(active[sessionID]),
    session,
  };
}
