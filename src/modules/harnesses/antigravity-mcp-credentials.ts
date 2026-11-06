import type { McpServerConfig } from "@/core/types/app-state";
import { secureSecretStore } from "@/core/services/secrets";
import { getMcpOAuthAccessToken } from "@/modules/mcp/oauth";
import type { AcpMcpServer } from "./antigravity";
import {
  buildAntigravityMcpServers,
  type AntigravityMcpCredentials,
  type AntigravityPhoneTools,
} from "./antigravity-mcp";

function wantsCredentials(
  server: McpServerConfig,
  selectedServerIds: string[] | null,
) {
  if (!server.enabled || !server.url.trim()) return false;
  if (selectedServerIds === null) return true;
  return selectedServerIds.includes(server.id);
}

/**
 * Load only the credentials needed for the MCP servers in this session.
 * OAuth tokens are refreshed when possible; a missing token still leaves the
 * server available so Antigravity can surface its own authorization flow.
 */
export async function resolveAntigravityMcpServers(input: {
  servers: McpServerConfig[];
  selectedServerIds: string[] | null;
  phoneTools?: AntigravityPhoneTools | null;
}): Promise<AcpMcpServer[]> {
  const credentials: AntigravityMcpCredentials = {
    headerValues: {},
    oauthTokens: {},
  };

  await Promise.all(
    input.servers
      .filter((server) =>
        wantsCredentials(server, input.selectedServerIds),
      )
      .map(async (server) => {
        if (server.authMode === "headers") {
          credentials.headerValues[server.id] =
            await secureSecretStore
              .getMcpHeaderValues(server.id)
              .catch(() => ({}));
          return;
        }
        if (server.authMode !== "oauth") return;
        try {
          credentials.oauthTokens[server.id] =
            await getMcpOAuthAccessToken(server);
        } catch (cause) {
          // A stale OAuth session should not block the rest of the chat from
          // starting. The MCP server will return its own authorization error.
          console.warn(
            `Could not refresh MCP OAuth credentials for ${server.label || server.id}.`,
            cause,
          );
          credentials.oauthTokens[server.id] = null;
        }
      }),
  );

  return buildAntigravityMcpServers({
    servers: input.servers,
    selectedServerIds: input.selectedServerIds,
    credentials,
    phoneTools: input.phoneTools,
  });
}
