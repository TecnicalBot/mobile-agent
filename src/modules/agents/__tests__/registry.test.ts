import { describe, expect, it } from "vitest";

import type { AgentConfig } from "@/core/types/app-state";

import {
  DEFAULT_AGENT_NAME,
  GENERAL_SUBAGENT_NAME,
  NATIVE_AGENTS,
  PLAN_AGENT_NAME,
  listPrimaryAgents,
  listSubagents,
  resolveAgent,
} from "../registry";
import {
  MUTATING_BUILT_IN_TOOL_NAMES,
  agentAllowsBuiltInKey,
  filterMcpServerIdsByAgentPermissions,
  filterToolsByAgentPermissions,
  isPlanAgent,
} from "../permissions";

function makeAgent(overrides: Partial<AgentConfig>): AgentConfig {
  return {
    createdAt: "",
    description: null,
    enabled: true,
    hidden: false,
    id: overrides.name ?? "custom",
    mode: "all",
    modelModelId: null,
    modelProviderId: null,
    name: "custom",
    prompt: null,
    sourceMarkdown: null,
    temperature: null,
    toolPermissions: {},
    docs: [],
    updatedAt: "",
    ...overrides,
  };
}

describe("agent registry", () => {
  it("falls back to the default build agent", () => {
    expect(resolveAgent([], null).name).toBe(DEFAULT_AGENT_NAME);
    expect(resolveAgent([], "does-not-exist").name).toBe(DEFAULT_AGENT_NAME);
    expect(NATIVE_AGENTS.map((agent) => agent.name)).toContain(
      DEFAULT_AGENT_NAME,
    );
  });

  it("resolves native agents by name and user rows by id", () => {
    expect(resolveAgent([], "plan").name).toBe(PLAN_AGENT_NAME);

    const row = makeAgent({ id: "row-1", name: "researcher" });
    expect(resolveAgent([row], "row-1").id).toBe("row-1");
    expect(resolveAgent([row], "researcher").id).toBe("row-1");
  });

  it("prefers enabled rows over natives of the same name and skips disabled ones", () => {
    const override = makeAgent({
      id: "row-plan",
      name: PLAN_AGENT_NAME,
      prompt: "Custom plan prompt",
      temperature: 0.2,
    });

    expect(resolveAgent([override], PLAN_AGENT_NAME).id).toBe("row-plan");

    const disabled = { ...override, enabled: false };
    expect(resolveAgent([disabled], PLAN_AGENT_NAME).id).toBe(PLAN_AGENT_NAME);
  });

  it("lists primary agents with build first and excludes subagent-only rows", () => {
    const agents = [
      makeAgent({ id: "zeta", name: "zeta", mode: "primary" }),
      makeAgent({ id: "sub", name: "sub", mode: "subagent" }),
      makeAgent({ id: "off", name: "off", enabled: false }),
    ];

    const primary = listPrimaryAgents(agents).map((agent) => agent.name);

    expect(primary[0]).toBe(DEFAULT_AGENT_NAME);
    expect(primary).toContain("zeta");
    expect(primary).toContain(PLAN_AGENT_NAME);
    expect(primary).not.toContain("sub");
    expect(primary).not.toContain("off");
  });

  it("lists subagents including general and all-mode agents", () => {
    const agents = [
      makeAgent({ id: "helper", name: "helper", mode: "subagent" }),
      makeAgent({ id: "dual", name: "dual", mode: "all" }),
      makeAgent({ id: "solo", name: "solo", mode: "primary" }),
    ];

    const subagents = listSubagents(agents).map((agent) => agent.name);

    expect(subagents).toContain(GENERAL_SUBAGENT_NAME);
    expect(subagents).toContain("helper");
    expect(subagents).toContain("dual");
    expect(subagents).not.toContain("solo");
  });
});

describe("agent permissions", () => {
  it("detects plan agents", () => {
    expect(isPlanAgent(getNativeAgentShim(PLAN_AGENT_NAME))).toBe(true);
    expect(isPlanAgent(makeAgent({ name: "custom" }))).toBe(false);
  });

  function getNativeAgentShim(name: string): AgentConfig {
    return resolveAgent([], name);
  }

  it("drops mutating tools for plan agents regardless of permissions", () => {
    const tools = {
      edit: {},
      read: {},
      write: {},
    };
    const keyMap = { edit: "workspaceEdit", read: "workspaceRead", write: "workspaceWrite" } as const;

    const filtered = filterToolsByAgentPermissions(
      tools,
      getNativeAgentShim(PLAN_AGENT_NAME),
      keyMap,
    );

    expect(Object.keys(filtered)).toEqual(["read"]);
  });

  it("applies built-in deny rules from toolPermissions", () => {
    const agent = makeAgent({
      name: "writer",
      toolPermissions: { builtInTools: { workspaceWrite: false } },
    });
    const keyMap = { read: "workspaceRead", write: "workspaceWrite" } as const;

    const filtered = filterToolsByAgentPermissions(
      { read: {}, write: {} },
      agent,
      keyMap,
    );

    expect(Object.keys(filtered)).toEqual(["read"]);
    expect(agentAllowsBuiltInKey(agent, "workspaceWrite")).toBe(false);
    expect(agentAllowsBuiltInKey(agent, "workspaceRead")).toBe(true);
  });

  it("filters MCP servers using allow-list or deny-list semantics", () => {
    const deny = makeAgent({
      toolPermissions: { mcpServers: { serverA: false } },
    });
    expect(
      filterMcpServerIdsByAgentPermissions(["serverA", "serverB"], deny),
    ).toEqual(["serverB"]);

    const allow = makeAgent({
      toolPermissions: { mcpServers: { serverA: true } },
    });
    expect(
      filterMcpServerIdsByAgentPermissions(["serverA", "serverB"], allow),
    ).toEqual(["serverA"]);
  });

  it("keeps mutating tool names in sync with the plan filter", () => {
    expect(MUTATING_BUILT_IN_TOOL_NAMES.has("write")).toBe(true);
    expect(MUTATING_BUILT_IN_TOOL_NAMES.has("task")).toBe(true);
  });
});
