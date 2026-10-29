import type { OpenCodeClient } from "@opencode/client";

/**
 * One stable name per directory. The old scheme appended the token prefix, so
 * every sharing session left another dead server entry behind in the project
 * config and each harness start had to discover a different name.
 */
export const PHONE_TOOLS_SERVER = "mobile_agent_phone";
const LEGACY_PREFIX = `${PHONE_TOOLS_SERVER}_`;

/** In-memory record of what this client already has attached, per directory. */
const attached = new WeakMap<
  OpenCodeClient,
  Map<string, { url: string; token: string; instanceID?: string }>
>();

export class PhoneToolsConnectionError extends Error {}

function connectionFailure(status?: { status: string; error?: string }) {
  const detail = status?.error ?? "";
  if (/401|403|auth/i.test(detail))
    return new PhoneToolsConnectionError(
      "Phone MCP authentication was rejected. Restart sharing and reconnect OpenCode.",
    );
  if (/400|parse error|invalid json|undefined is not a function/i.test(detail))
    return new PhoneToolsConnectionError(
      "OpenCode reached the phone, but the MCP handshake failed. Reload Mobile Agent before reconnecting.",
    );
  if (/ECONNRESET|socket.*closed/i.test(detail))
    return new PhoneToolsConnectionError(
      "The phone closed the MCP connection before OpenCode received a response.",
    );
  if (/timeout|timed out|ECONNREFUSED|unreachable|fetch failed/i.test(detail))
    return new PhoneToolsConnectionError(
      "OpenCode could not reach the phone MCP address. Check the selected network and keep Mobile Agent open.",
    );
  return new PhoneToolsConnectionError(
    "OpenCode did not connect to the phone tools bridge. Check its MCP status in this chat's workspace.",
  );
}

function locationFor(directory?: string) {
  return directory ? { directory } : undefined;
}

/** OpenCode-specific configuration stays outside the shared MCP server. */
export async function attachOpenCodePhoneTools(input: {
  client: OpenCodeClient;
  url: string;
  token: string;
  instanceID?: string;
  directory?: string;
  signal: AbortSignal;
}): Promise<() => Promise<void>> {
  const location = locationFor(input.directory);
  const remove = async (server = PHONE_TOOLS_SERVER) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await input.client.mcp.remove(
        { server, location },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }
  };
  const catalog = async () =>
    (await input.client.mcp.list({ location }, { signal: input.signal })).data;

  // Sweep names created by the old per-session scheme. Leaving them behind made
  // the harness list grow without bound and confused the auto-attach check.
  for (const item of await catalog().catch(() => []))
    if (item.name.startsWith(LEGACY_PREFIX))
      await remove(item.name).catch(() => {});

  const key = input.directory ?? "";
  let bindings = attached.get(input.client);
  if (!bindings) {
    bindings = new Map();
    attached.set(input.client, bindings);
  }
  const previous = bindings.get(key);
  const existing = (await catalog().catch(() => [])).find(
    (item) => item.name === PHONE_TOOLS_SERVER,
  );
  if (
    existing &&
    previous?.url === input.url &&
    previous.token === input.token &&
    previous.instanceID === input.instanceID
  ) {
    if (existing.status.status === "connected") return () => remove();
    // The entry is ours and points at the same URL; a reconnect is enough.
    try {
      await input.client.mcp.connect(
        { server: PHONE_TOOLS_SERVER, location },
        { signal: input.signal },
      );
      if (
        (await catalog()).some(
          (item) =>
            item.name === PHONE_TOOLS_SERVER &&
            item.status.status === "connected",
        )
      ) {
        return () => remove();
      }
    } catch {
      // Fall through and rewrite the entry.
    }
  }

  // A stale entry (old address, rotated token, or a previous app install) is
  // replaced rather than reused. Add is not an upsert in every OpenCode build.
  if (existing) await remove().catch(() => {});
  bindings.delete(key);

  try {
    await input.client.mcp.add(
      {
        server: PHONE_TOOLS_SERVER,
        location,
        config: {
          type: "remote",
          url: input.url,
          oauth: false,
          protocol: "legacy",
          codemode: false,
          headers: { Authorization: `Bearer ${input.token}` },
          timeout: { execution: 900000 },
        },
      },
      { signal: input.signal },
    );
    await input.client.mcp.connect(
      { server: PHONE_TOOLS_SERVER, location },
      { signal: input.signal },
    );
    const registered = (await catalog()).find(
      (item) => item.name === PHONE_TOOLS_SERVER,
    );
    if (registered?.status.status !== "connected")
      throw connectionFailure(registered?.status);
    bindings.set(key, {
      url: input.url,
      token: input.token,
      instanceID: input.instanceID,
    });
    return () => {
      bindings?.delete(key);
      return remove();
    };
  } catch (error) {
    await remove().catch(() => {});
    throw error;
  }
}
