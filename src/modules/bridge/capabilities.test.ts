import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/tools/workspace-tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  const make = (name: string) =>
    tool({
      description: `Test ${name}`,
      inputSchema: z.object({}),
      execute: async () => ({ name }),
    });
  return {
    createWorkspaceTools: () => ({
      // The production allowlist decides which keys are exposed; this proxy
      // only supplies a valid AI SDK tool for whichever key it asks for.
      tools: new Proxy({}, { get: (_target, key) => make(String(key)) }),
    }),
  };
});

const { createPhoneBridgeCapabilities } = await import("./capabilities");

describe("phone bridge workspace tools", () => {
  it("shares the local media tools the render contract tells the agent to use", async () => {
    const tools = await createPhoneBridgeCapabilities({
      grant: { folder: null, workspace: true, skills: false },
      repositories: {} as never,
      onRecord: () => {},
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "transcribeAudio",
        "analyzeAudio",
        "textToSpeech",
        "listVoices",
      ]),
    );
  });

  it("still keeps network-facing tools out of the bridge", async () => {
    const tools = await createPhoneBridgeCapabilities({
      grant: { folder: null, workspace: true, skills: false },
      repositories: {} as never,
      onRecord: () => {},
    });
    const names = tools.map((tool) => tool.name);

    expect(names).not.toContain("browser");
    expect(names).not.toContain("fetchPage");
  });
});
