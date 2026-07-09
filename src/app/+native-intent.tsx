const MCP_OAUTH_CALLBACK_ROUTE = "/mcp/oauth/callback";

function stripQueryAndHash(path: string) {
  return path.split(/[?#]/, 1)[0] ?? path;
}

function isMcpOAuthCallback(path: string) {
  try {
    const url = new URL(path, "mobile-agent://app.home");

    return (
      (url.hostname === "mcp" && url.pathname === "/oauth/callback") ||
      url.pathname === MCP_OAUTH_CALLBACK_ROUTE
    );
  } catch {
    const normalizedPath = stripQueryAndHash(path);

    return (
      normalizedPath === MCP_OAUTH_CALLBACK_ROUTE ||
      normalizedPath === "mcp/oauth/callback" ||
      normalizedPath === "/oauth/callback" ||
      normalizedPath === "oauth/callback"
    );
  }
}

export function redirectSystemPath({ path }: { initial: boolean; path: string }) {
  if (isMcpOAuthCallback(path)) {
    return MCP_OAUTH_CALLBACK_ROUTE;
  }

  return path;
}
