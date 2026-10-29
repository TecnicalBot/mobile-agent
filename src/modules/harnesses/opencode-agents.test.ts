import { describe, expect, it, vi } from "vitest";
import type { AgentInfo, ConfigEntry, OpenCodeClient } from "@opencode/client";
import {
  readOpenCodeAgents,
  resolveOpenCodeDefaultAgent,
} from "./opencode-agents";

const agent = (id: string, options: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: id === "build" ? "Build" : id === "plan" ? "Plan" : id,
  mode: "primary",
  hidden: false,
  request: { settings: {}, headers: {}, body: {} },
  permissions: [],
  ...options,
});
const config = (default_agent?: string): ConfigEntry => ({
  type: "document",
  info: { default_agent },
});

describe("OpenCode default agent resolution", () => {
  it("uses the configured default rather than a generic label", () => {
    expect(
      resolveOpenCodeDefaultAgent(
        [agent("build"), agent("plan")],
        [config("plan")],
      )?.name,
    ).toBe("Plan");
  });
  it("respects later configuration overrides", () => {
    expect(
      resolveOpenCodeDefaultAgent(
        [agent("build"), agent("review")],
        [config("build"), config(), config("review")],
      )?.id,
    ).toBe("review");
  });
  it.each([undefined, "missing", "hidden", "subagent"])(
    "falls back to the actual Build agent for an invalid default (%s)",
    (name) => {
      expect(
        resolveOpenCodeDefaultAgent(
          [
            agent("hidden", { hidden: true }),
            agent("subagent", { mode: "subagent" }),
            agent("plan"),
            agent("build"),
          ],
          [config(name)],
        )?.name,
      ).toBe("Build");
    },
  );
  it("uses the first visible primary agent if Build is absent", () => {
    expect(
      resolveOpenCodeDefaultAgent(
        [agent("hidden", { hidden: true }), agent("writer")],
        [],
      )?.id,
    ).toBe("writer");
  });
  it("does not invent a default when no primary agents are available", () => {
    expect(
      resolveOpenCodeDefaultAgent([agent("explore", { mode: "subagent" })], []),
    ).toBeNull();
  });
  it("reads configuration and agents from the same chat directory", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: [agent("build"), agent("plan")] });
    const get = vi.fn().mockResolvedValue([config("plan")]);
    const client = {
      agent: { list },
      config: { get },
    } as unknown as OpenCodeClient;
    const signal = new AbortController().signal;
    expect(
      (await readOpenCodeAgents(client, "/project", signal)).defaultAgent?.id,
    ).toBe("plan");
    expect(list).toHaveBeenCalledWith(
      { location: { directory: "/project" } },
      { signal },
    );
    expect(get).toHaveBeenCalledWith(
      { location: { directory: "/project" } },
      { signal },
    );
  });
});
