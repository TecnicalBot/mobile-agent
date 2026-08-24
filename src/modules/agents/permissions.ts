import type { AgentConfig, BuiltInToolKey } from "@/core/types/app-state";

import { PLAN_AGENT_NAME } from "@/modules/agents/registry";

export const MUTATING_BUILT_IN_TOOL_NAMES = new Set([
  "createDirectory",
  "createFile",
  "deleteEntry",
  "downloadFile",
  "edit",
  "exportWorkspaceFileToFolder",
  "importFolderFileToWorkspace",
  "manageAgent",
  "manageSkill",
  "moveEntry",
  "renameEntry",
  "task",
  "write",
]);

export const SUBAGENT_DEFAULT_DENIED_TOOL_NAMES = new Set([
  "cancel_schedule",
  "forgetMemory",
  "importSkillFromUrl",
  "list_schedules",
  "manageAgent",
  "manageSkill",
  "schedule_task",
  "task",
  "update_schedule",
  "update_memory",
  "writeMemory",
]);

export function isPlanAgent(agent: AgentConfig): boolean {
  return agent.id === PLAN_AGENT_NAME || agent.name === PLAN_AGENT_NAME;
}

/** Whether the agent's toolPermissions explicitly allow a built-in tool key. */
export function agentAllowsBuiltInKey(
  agent: AgentConfig,
  key: BuiltInToolKey,
): boolean {
  return agent.toolPermissions.builtInTools?.[key] !== false;
}

/**
 * Filter a built-in runtime toolset by the agent's permissions.
 * `toolNameToKey` maps each runtime tool name in this toolset to the
 * BuiltInToolKey that governs it (workspace vs folder contexts differ).
 * Plan agents always drop mutating tools regardless of permissions.
 */
export function filterToolsByAgentPermissions(
  tools: Record<string, unknown>,
  agent: AgentConfig,
  toolNameToKey: Record<string, BuiltInToolKey>,
): Record<string, unknown> {
  const plan = isPlanAgent(agent);

  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => {
      if (plan && MUTATING_BUILT_IN_TOOL_NAMES.has(name)) {
        return false;
      }

      const key = toolNameToKey[name];

      if (!key) {
        return true;
      }

      return agentAllowsBuiltInKey(agent, key);
    }),
  );
}

/** Server ids the agent allows, given the candidate list for this run. */
export function filterMcpServerIdsByAgentPermissions(
  serverIds: string[],
  agent: AgentConfig,
): string[] {
  const mcpPermissions = agent.toolPermissions.mcpServers;

  if (!mcpPermissions) {
    return serverIds;
  }

  const hasAnyAllow = Object.values(mcpPermissions).some((value) => value);

  return serverIds.filter((serverId) => {
    const allowed = mcpPermissions[serverId];

    if (allowed !== undefined) {
      return allowed;
    }

    return !hasAnyAllow;
  });
}
