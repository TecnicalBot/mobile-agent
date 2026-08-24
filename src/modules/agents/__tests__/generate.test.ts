import { describe, expect, it } from "vitest";

import {
  buildAgentGeneratePrompt,
  parseAgentJsonDraft,
} from "../generate";

describe("agent generate", () => {
  it("builds a prompt with existing and reserved names", () => {
    const prompt = buildAgentGeneratePrompt({
      description: "reviews code",
      existingNames: ["researcher"],
      hasPrompt: false,
    });

    expect(prompt).toContain("reviews code");
    expect(prompt).toContain("researcher");
    expect(prompt).toContain("build");
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"systemPrompt"');
  });

  it("parses JSON objects embedded in model output", () => {
    const parsed = parseAgentJsonDraft(
      'Sure! Here it is:\n```json\n{"name": "code-reviewer", "description": "Reviews code", "systemPrompt": "Be thorough."}\n```',
    );

    expect(parsed.name).toBe("code-reviewer");
    expect(parsed.description).toBe("Reviews code");
    expect(parsed.systemPrompt).toBe("Be thorough.");
  });

  it("throws on non-JSON output", () => {
    expect(() => parseAgentJsonDraft("no json here")).toThrow();
    expect(() => parseAgentJsonDraft('{"name": }')).toThrow();
    expect(() => parseAgentJsonDraft("[1,2,3]")).toThrow();
  });

  it("accepts identifier as an alias for name", () => {
    const parsed = parseAgentJsonDraft(
      '{"identifier": "helper", "description": null, "systemPrompt": ""}',
    );

    expect(parsed.name).toBe("helper");
    expect(parsed.description).toBeNull();
    expect(parsed.systemPrompt).toBeNull();
  });
});
