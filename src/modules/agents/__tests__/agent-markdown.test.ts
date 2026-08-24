import { describe, expect, it } from "vitest";

import {
  normalizeAgentName,
  parseAgentMarkdown,
  serializeAgentToMarkdown,
  slugifyAgentName,
} from "../agent-markdown";

describe("agent-markdown", () => {
  it("slugifies agent names properly", () => {
    expect(slugifyAgentName("Code Reviewer 2")).toBe("code-reviewer-2");
    expect(normalizeAgentName("")).toBe("agent");
    expect(normalizeAgentName("Special @#$ Name!")).toBe("special-name");
  });

  it("parses AGENT.md with full frontmatter", () => {
    const raw = `---
name: code-reviewer
description: Reviews code changes for quality
mode: subagent
model: anthropic/claude-sonnet-4
temperature: 0.15
tools:
  workspaceWrite: false
  workspaceEdit: false
  "mcp:github-server": true
---

You are a meticulous code reviewer.
`;

    const parsed = parseAgentMarkdown(raw);

    expect(parsed.name).toBe("code-reviewer");
    expect(parsed.slug).toBe("code-reviewer");
    expect(parsed.description).toBe("Reviews code changes for quality");
    expect(parsed.mode).toBe("subagent");
    expect(parsed.modelProviderId).toBe("anthropic");
    expect(parsed.modelModelId).toBe("claude-sonnet-4");
    expect(parsed.temperature).toBeCloseTo(0.15);
    expect(parsed.toolPermissions.builtInTools).toEqual({
      workspaceEdit: false,
      workspaceWrite: false,
    });
    expect(parsed.toolPermissions.mcpServers).toEqual({
      "github-server": true,
    });
    expect(parsed.prompt).toBe("You are a meticulous code reviewer.");
  });

  it("rejects files without frontmatter or a name", () => {
    expect(() => parseAgentMarkdown("# Just markdown")).toThrow();
    expect(() =>
      parseAgentMarkdown("---\ndescription: no name\n---\n\nBody"),
    ).toThrow();
  });

  it("round-trips parse then serialize", () => {
    const raw = `---
name: research-assistant
description: Deep research helper
mode: all
model: openai/gpt-5.2
temperature: 0.3
tools:
  folderRead: false
  mcp:web-search: true
---

Research thoroughly and cite sources.
`;

    const parsed = parseAgentMarkdown(raw);

    expect(parsed.mode).toBe("all");

    const serialized = serializeAgentToMarkdown({
      description: parsed.description,
      mode: parsed.mode,
      modelModelId: parsed.modelModelId,
      modelProviderId: parsed.modelProviderId,
      name: parsed.name,
      prompt: parsed.prompt,
      temperature: parsed.temperature,
      toolPermissions: parsed.toolPermissions,
    });

    const reparsed = parseAgentMarkdown(serialized);

    expect(reparsed.name).toBe(parsed.name);
    expect(reparsed.description).toBe(parsed.description);
    expect(reparsed.mode).toBe(parsed.mode);
    expect(reparsed.modelProviderId).toBe(parsed.modelProviderId);
    expect(reparsed.modelModelId).toBe(parsed.modelModelId);
    expect(reparsed.temperature).toBeCloseTo(0.3);
    expect(reparsed.prompt).toBe(parsed.prompt);
    expect(reparsed.toolPermissions.builtInTools).toEqual(
      parsed.toolPermissions.builtInTools,
    );
    expect(reparsed.toolPermissions.mcpServers).toEqual(
      parsed.toolPermissions.mcpServers,
    );
  });

  it("throws when serializing an empty prompt", () => {
    expect(() =>
      serializeAgentToMarkdown({
        description: null,
        mode: "all",
        modelModelId: null,
        modelProviderId: null,
        name: "empty",
        prompt: "",
        temperature: null,
        toolPermissions: {},
      }),
    ).toThrow();
  });
});
