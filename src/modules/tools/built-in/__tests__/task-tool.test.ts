import { describe, expect, it } from "vitest";

import type { AgentConfig } from "@/core/types/app-state";

import {
  createTaskTool,
  describeSubagentCatalog,
} from "../task-tool";

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
    updatedAt: "",
    ...overrides,
  };
}

describe("task-tool", () => {
  it("describes subagents and falls back when none exist", () => {
    const empty = describeSubagentCatalog([
      makeAgent({ name: "solo", mode: "primary" }),
    ]);
    expect(empty).toContain("No subagents are configured");

    const catalog = describeSubagentCatalog([
      makeAgent({
        name: "researcher",
        mode: "subagent",
        description: "Deep research",
      }),
      makeAgent({ name: "build", mode: "all" }),
    ]);
    expect(catalog).toContain("researcher: Deep research");
    expect(catalog).toContain("build:");
  });

  it("rejects unknown or primary-only targets", async () => {
    const { tools } = createTaskTool({
      getAgents: () => [
        makeAgent({ name: "plan", mode: "primary" }),
        makeAgent({ name: "helper", mode: "subagent" }),
      ],
      spawnSubagent: async () => ({ output: "should not run" }),
    });

    const unknown = await tools.task.execute!(
      {
        description: "Try it",
        prompt: "Do a thing",
        subagent_type: "missing",
      },
      { abortSignal: undefined, messages: [], toolCallId: "t1" } as never,
    );
    expect(unknown).toMatchObject({ ok: false });

    const primary = await tools.task.execute!(
      {
        description: "Try it",
        prompt: "Do a thing",
        subagent_type: "plan",
      },
      { abortSignal: undefined, messages: [], toolCallId: "t2" } as never,
    );
    expect(primary).toMatchObject({ ok: false });
  });

  it("spawns subagents and surfaces failures", async () => {
    const spawned: string[] = [];
    const success = createTaskTool({
      getAgents: () => [makeAgent({ name: "helper", mode: "subagent" })],
      onRecord: undefined,
      spawnSubagent: async (task) => {
        spawned.push(task.agentName);
        return { output: "done" };
      },
    });

    const ok = await success.tools.task.execute!(
      {
        description: "Research",
        prompt: "Research stuff",
        subagent_type: "helper",
      },
      { abortSignal: undefined, messages: [], toolCallId: "t3" } as never,
    );
    expect(ok).toMatchObject({ ok: true, result: "done" });
    expect(spawned).toEqual(["helper"]);

    const failing = createTaskTool({
      getAgents: () => [makeAgent({ name: "helper", mode: "subagent" })],
      spawnSubagent: async () => {
        throw new Error("boom");
      },
    });

    const failed = await failing.tools.task.execute!(
      {
        description: "Research",
        prompt: "Research stuff",
        subagent_type: "helper",
      },
      { abortSignal: undefined, messages: [], toolCallId: "t4" } as never,
    );
    expect(failed).toMatchObject({ ok: false });
    expect((failed as { error: string }).error).toContain("boom");
  });
});
