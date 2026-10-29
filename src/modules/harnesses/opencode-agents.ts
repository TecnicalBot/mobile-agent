import type { AgentInfo, ConfigEntry, OpenCodeClient } from "@opencode/client";

/** Match OpenCode's documented default selection and invalid-default fallback. */
export function resolveOpenCodeDefaultAgent(
  agents: AgentInfo[],
  config: ConfigEntry[],
) {
  let configured: string | undefined;
  // The API returns configuration sources in merge order. Directory entries
  // contribute definitions, but only documents carry default_agent.
  for (const entry of config) {
    if (entry.type === "document" && entry.info?.default_agent !== undefined) {
      configured = entry.info.default_agent;
    }
  }
  const selectable = agents.filter(
    (agent) => !agent.hidden && agent.mode !== "subagent",
  );
  return (
    selectable.find((agent) => agent.id === configured) ??
    selectable.find((agent) => agent.id === "build") ??
    selectable[0] ??
    null
  );
}

export async function readOpenCodeAgents(
  client: OpenCodeClient,
  directory: string | undefined,
  signal: AbortSignal,
) {
  const location = directory ? { directory } : undefined;
  const [catalog, config] = await Promise.all([
    client.agent.list({ location }, { signal }),
    client.config.get({ location }, { signal }),
  ]);
  return {
    agents: catalog.data,
    defaultAgent: resolveOpenCodeDefaultAgent(catalog.data, config),
  };
}
