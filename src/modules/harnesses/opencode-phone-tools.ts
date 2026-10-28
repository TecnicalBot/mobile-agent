import type { OpenCodeClient } from "@opencode/client";

/** OpenCode-specific configuration stays outside the shared MCP server. */
export async function attachOpenCodePhoneTools(input: {
  client: OpenCodeClient;
  url: string;
  token: string;
  directory?: string;
  signal: AbortSignal;
}) {
  // A unique name avoids overwriting any user-managed MCP configuration.
  const server = `mobile_agent_phone_${input.token.slice(0, 8)}`;
  const location = input.directory ? { directory: input.directory } : undefined;
  const remove = async () => {
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
  try {
    await input.client.mcp.add(
      {
        server,
        location,
        config: {
          type: "remote",
          url: input.url,
          oauth: false,
          protocol: "legacy",
          headers: { Authorization: `Bearer ${input.token}` },
          timeout: { execution: 900000 },
        },
      },
      { signal: input.signal },
    );
    await input.client.mcp.connect(
      { server, location },
      { signal: input.signal },
    );
    return remove;
  } catch (error) {
    await remove().catch(() => {});
    throw error;
  }
}
