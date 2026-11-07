import type { McpServerConfig } from "@/core/types/app-state";
import { secureSecretStore } from "@/core/services/secrets";
import { getMcpOAuthAccessToken } from "@/modules/mcp/oauth";
import type { AcpMcpServer } from "./acp-client";
import {
  buildAcpMcpServers,
  type AcpMcpCredentials,
  type AcpPhoneTools,
} from "./acp-mcp";

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
 * server available so the agent can surface its own authorization flow.
 */
export async function resolveAcpMcpServers(input: {
  servers: McpServerConfig[];
  selectedServerIds: string[] | null;
  phoneTools?: AcpPhoneTools | null;
}): Promise<AcpMcpServer[]> {
  const credentials: AcpMcpCredentials = {
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

  return buildAcpMcpServers({
    servers: input.servers,
    selectedServerIds: input.selectedServerIds,
    credentials,
    phoneTools: input.phoneTools,
  });
}
