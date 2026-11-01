import { describe, expect, it, vi } from "vitest";

const factoryParams = vi.hoisted(() => ({
  workspace: null as { supportsImageInput?: boolean } | null,
  folder: null as { supportsImageInput?: boolean } | null,
}));

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
    createWorkspaceTools: (params: { supportsImageInput?: boolean }) => {
      factoryParams.workspace = params;
      return {
        // The production allowlist decides which keys are exposed; this proxy
        // only supplies a valid AI SDK tool for whichever key it asks for.
        tools: new Proxy({}, { get: (_target, key) => make(String(key)) }),
      };
    },
  };
});

vi.mock("@/modules/tools/external-folder-tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  const make = (name: string) =>
    tool({
      description: `Test ${name}`,
      inputSchema: z.object({}),
      execute: async () => ({ name }),
    });
  return {
    createExternalFolderTools: (params: { supportsImageInput?: boolean }) => {
      factoryParams.folder = params;
      return {
        tools: new Proxy({}, { get: (_target, key) => make(String(key)) }),
      };
    },
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

  it("lets shared viewFile tools return images to the harness", async () => {
    await createPhoneBridgeCapabilities({
      grant: { folder: null, workspace: true, skills: false },
      repositories: {} as never,
      onRecord: () => {},
    });
    expect(factoryParams.workspace?.supportsImageInput).toBe(true);

    await createPhoneBridgeCapabilities({
      grant: {
        folder: {
          uri: "content://shared/folder",
          displayName: "Shared",
          platform: "android",
          sourceType: "external-folder",
          grantedAt: new Date(0).toISOString(),
        },
        workspace: false,
        skills: false,
      },
      repositories: {} as never,
      onRecord: () => {},
    });
    expect(factoryParams.folder?.supportsImageInput).toBe(true);
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
