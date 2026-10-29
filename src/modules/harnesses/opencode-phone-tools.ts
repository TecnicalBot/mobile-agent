import type { OpenCodeClient } from "@opencode/client";

/**
 * One stable name per directory. The old scheme appended the token prefix, so
 * every sharing session left another dead server entry behind in the project
 * config and each harness start had to discover a different name.
 */
export const PHONE_TOOLS_SERVER = "mobile_agent_phone";
const LEGACY_PREFIX = `${PHONE_TOOLS_SERVER}_`;

/** In-memory record of what this client already has attached, per directory. */
const attached = new WeakMap<OpenCodeClient, Map<string, string>>();

function locationFor(directory?: string) {
  return directory ? { directory } : undefined;
}

/** OpenCode-specific configuration stays outside the shared MCP server. */
export async function attachOpenCodePhoneTools(input: {
  client: OpenCodeClient;
  url: string;
  token: string;
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
  const previousUrl = bindings.get(key);
  const existing = (await catalog().catch(() => [])).find(
    (item) => item.name === PHONE_TOOLS_SERVER,
  );
  if (existing && previousUrl === input.url) {
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
    if (
      !(await catalog()).some(
        (item) =>
          item.name === PHONE_TOOLS_SERVER &&
          item.status.status === "connected",
      )
    ) {
      throw new Error("OpenCode did not connect to the phone tools bridge.");
    }
    bindings.set(key, input.url);
    return () => {
      bindings?.delete(key);
      return remove();
    };
  } catch (error) {
    await remove().catch(() => {});
    throw error;
  }
}
