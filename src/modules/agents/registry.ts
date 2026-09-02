import type {
  AgentConfig,
  AppStateSnapshot,
} from "@/core/types/app-state";

export const DEFAULT_AGENT_NAME = "build";
export const PLAN_AGENT_NAME = "plan";
export const GENERAL_SUBAGENT_NAME = "general";

const PLAN_AGENT_SYSTEM_PROMPT = [
  "You are in Plan mode. You may research, inspect, and analyze, but you must NOT make any changes.",
  "Never create, write, edit, delete, move, or rename files. Never tap, type, or otherwise operate the device. Never modify memory or MCP-connected systems.",
  "Your mutating tools are disabled, so attempting a change is impossible. Instead, investigate the relevant topic and present a clear, step-by-step plan.",
  "Read-only MCP tools, such as web search, remain available for research. Never call an MCP tool that would modify or send data.",
  "Structure your plan with the specific steps involved, why each step is needed, and any risks or trade-offs you noticed.",
  "End by telling the user to switch to the Build agent when they are ready for you to make the changes.",
].join("\n");

function nativeAgent(input: {
  description: string;
  hidden?: boolean;
  mode: AgentConfig["mode"];
  name: string;
  prompt?: string;
}): AgentConfig {
  return {
    createdAt: "",
    description: input.description,
    enabled: true,
    hidden: input.hidden ?? false,
    id: input.name,
    mode: input.mode,
    modelModelId: null,
    modelProviderId: null,
    name: input.name,
    prompt: input.prompt ?? null,
    sourceMarkdown: null,
    temperature: null,
    toolPermissions: {},
    docs: [],
    updatedAt: "",
  };
}

export const NATIVE_AGENTS: AgentConfig[] = [
  nativeAgent({
    description:
      "The default agent. Executes tasks with all configured tools and permissions.",
    mode: "all",
    name: DEFAULT_AGENT_NAME,
  }),
  nativeAgent({
    description:
      "Plan mode. Researches and presents plans without making any changes.",
    mode: "primary",
    name: PLAN_AGENT_NAME,
    prompt: PLAN_AGENT_SYSTEM_PROMPT,
  }),
  nativeAgent({
    description:
      "General-purpose subagent for researching complex questions and executing multi-step tasks delegated by the primary agent.",
    mode: "subagent",
    name: GENERAL_SUBAGENT_NAME,
  }),
];

export function getNativeAgentByName(
  name: string,
): AgentConfig | null {
  return NATIVE_AGENTS.find((agent) => agent.name === name) ?? null;
}

export function isNativeAgentId(id: string): boolean {
  return NATIVE_AGENTS.some((agent) => agent.id === id);
}

/**
 * Resolve the effective agent for a conversation/run.
 * Accepts either a stored agent id (row id or native name) or null.
 * User rows override native definitions when they share a name;
 * disabled or missing rows fall back down the chain to the default agent.
 */
export function resolveAgent(
  agents: AgentConfig[],
  agentIdOrName: string | null | undefined,
): AgentConfig {
  const candidates: AgentConfig[] = [];

  const pushCandidate = (candidate: AgentConfig | null | undefined) => {
    if (candidate && candidate.enabled && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (agentIdOrName) {
    pushCandidate(
      agents.find((agent) => agent.id === agentIdOrName),
    );
    pushCandidate(
      agents.find((agent) => agent.name === agentIdOrName),
    );
    pushCandidate(getNativeAgentByName(agentIdOrName));
  }

  pushCandidate(getNativeAgentByName(DEFAULT_AGENT_NAME));

  return (
    candidates[0] ?? getNativeAgentByName(DEFAULT_AGENT_NAME)!
  );
}

/** Agents selectable as a chat persona: enabled, not hidden, not subagent-only. */
export function listPrimaryAgents(agents: AgentConfig[]): AgentConfig[] {
  const merged = new Map<string, AgentConfig>();

  for (const agent of NATIVE_AGENTS) {
    merged.set(agent.name, agent);
  }

  for (const agent of agents) {
    if (!agent.enabled) {
      merged.delete(agent.name);
      continue;
    }
    merged.set(agent.name, { ...agent });
  }

  return [...merged.values()]
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .sort((a, b) => {
      const nativeFirst =
        Number(b.name === DEFAULT_AGENT_NAME) -
        Number(a.name === DEFAULT_AGENT_NAME);
      if (nativeFirst !== 0) return nativeFirst;
      return a.name.localeCompare(b.name);
    });
}

/** Agents invocable through the task tool: enabled, not hidden, not primary-only. */
export function listSubagents(agents: AgentConfig[]): AgentConfig[] {
  const merged = new Map<string, AgentConfig>();

  for (const agent of NATIVE_AGENTS) {
    if (agent.mode !== "subagent" && agent.mode !== "all") {
      continue;
    }
    merged.set(agent.name, agent);
  }

  for (const agent of agents) {
    if (!agent.enabled || agent.hidden) {
      if (agent.mode !== "subagent") continue;
      merged.delete(agent.name);
      continue;
    }
    if (agent.mode === "primary") continue;
    merged.set(agent.name, { ...agent });
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveConversationAgent(
  snapshot: Pick<AppStateSnapshot, "agents">,
  conversationAgentId: string | null | undefined,
): AgentConfig {
  return resolveAgent(snapshot.agents, conversationAgentId);
}
