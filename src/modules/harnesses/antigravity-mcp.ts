import type { McpServerConfig } from "@/core/types/app-state";
import type { AcpMcpServer } from "./antigravity";

/** Matches OpenCode's phone tool server name so both harnesses read alike. */
export const ANTIGRAVITY_PHONE_MCP_SERVER = "mobile_agent_phone";

export type AntigravityMcpCredentials = {
  /** Header values loaded from SecureStore, keyed by MCP server ID. */
  headerValues: Record<string, Record<string, string>>;
  /** OAuth access tokens keyed by MCP server ID. */
  oauthTokens: Record<string, string | null>;
};

export type AntigravityPhoneTools = {
  url: string;
  token: string;
};

// Antigravity prefixes tool names with `mcp_<server>_<tool>` and rejects
// anything outside `[a-zA-Z0-9_-]`. Keep server names short as well so a normal
// MCP tool name still fits Antigravity's 64-character tool-name limit.
function sanitizeName(base: string) {
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return cleaned || "mcp";
}

function uniqueName(base: string, used: Set<string>) {
  const trimmed = sanitizeName(base);
  let candidate = trimmed;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${trimmed.slice(0, 24 - tail.length)}${tail}`;
  }
  used.add(candidate);
  return candidate;
}

function selectedServers(
  servers: McpServerConfig[],
  selectedServerIds: string[] | null,
) {
  const selected = selectedServerIds ? new Set(selectedServerIds) : null;
  return servers.filter(
    (server) =>
      server.enabled &&
      (selected === null || selected.has(server.id)) &&
      server.url.trim().length > 0,
  );
}

function serverHeaders(
  server: McpServerConfig,
  credentials: AntigravityMcpCredentials | undefined,
) {
  const headers: { name: string; value: string }[] = [];
  if (server.authMode === "headers") {
    for (const [name, value] of Object.entries(
      credentials?.headerValues[server.id] ?? {},
    )) {
      if (name.trim()) headers.push({ name: name.trim(), value });
    }
  } else if (server.authMode === "oauth") {
    const token = credentials?.oauthTokens[server.id]?.trim();
    if (token) headers.push({ name: "Authorization", value: `Bearer ${token}` });
  }
  return headers;
}

/**
 * Convert the app's MCP selection into ACP session MCP entries.
 *
 * App MCP servers are remote-only (HTTP/SSE), which is exactly what ACP
 * supports for remote transports. The phone tool bridge is a Streamable HTTP
 * MCP server, so it travels as another HTTP entry with its bearer token.
 */
export function buildAntigravityMcpServers(input: {
  servers: McpServerConfig[];
  selectedServerIds: string[] | null;
  credentials?: AntigravityMcpCredentials;
  phoneTools?: AntigravityPhoneTools | null;
}): AcpMcpServer[] {
  const used = new Set<string>();
  const result: AcpMcpServer[] = [];

  for (const server of selectedServers(
    input.servers,
    input.selectedServerIds,
  )) {
    result.push({
      type: server.transport,
      name: uniqueName(server.label || server.id, used),
      url: server.url.trim(),
      headers: serverHeaders(server, input.credentials),
    });
  }

  if (input.phoneTools?.url.trim()) {
    result.push({
      type: "http",
      name: uniqueName(ANTIGRAVITY_PHONE_MCP_SERVER, used),
      url: input.phoneTools.url.trim(),
      headers: input.phoneTools.token
        ? [
            {
              name: "Authorization",
              value: `Bearer ${input.phoneTools.token}`,
            },
          ]
        : [],
    });
  }

  return result;
}
