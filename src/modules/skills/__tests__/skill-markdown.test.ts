import { describe, expect, it } from "vitest";

import {
  normalizeSkillSlug,
  parseSkillMarkdown,
  serializeSkillToMarkdown,
  skillSlugMatches,
  slugifySkillName,
} from "../skill-markdown";
import { githubBlobToRaw, resolveSkillMarkdownUrl } from "../skill-github";

describe("skill-markdown", () => {
  it("slugifies skill names properly", () => {
    expect(slugifySkillName("My Skill 123")).toBe("my-skill-123");
    expect(slugifySkillName("Special @#$ Characters")).toBe("special-characters");
    expect(normalizeSkillSlug("")).toBe("skill");
  });

  it("checks skill slug matching", () => {
    const skill = {
      id: "1",
      title: "Git Helper",
      description: "Help with git",
      instructions: "Do git stuff",
      sourceMarkdown: null,
      enabled: true,
      autoMatch: true,
      matchKeywords: ["git"],
      recommendedMcpServerIds: [],
      recommendedBuiltInToolKeys: [],
      createdAt: "",
      updatedAt: "",
    };

    expect(skillSlugMatches(skill, "git-helper")).toBe(true);
    expect(skillSlugMatches(skill, "Git Helper")).toBe(true);
    expect(skillSlugMatches(skill, "other")).toBe(false);
  });

  it("parses and serializes SKILL.md with full built-in tools", () => {
    const raw = `---
name: code-reviewer
description: Review code changes
allowed-tools:
  - Create
  - Read
  - Edit
  - DownloadFile
  - FolderRead
  - Schedules
keywords:
  - review
  - pr
---

# Instructions
Review the code thoroughly.
`;

    const parsed = parseSkillMarkdown(raw);
    expect(parsed.title).toBe("code-reviewer");
    expect(parsed.description).toBe("Review code changes");
    expect(parsed.recommendedBuiltInToolKeys).toContain("workspaceCreateFile");
    expect(parsed.recommendedBuiltInToolKeys).toContain("workspaceRead");
    expect(parsed.recommendedBuiltInToolKeys).toContain("workspaceEdit");
    expect(parsed.recommendedBuiltInToolKeys).toContain("downloadFile");
    expect(parsed.recommendedBuiltInToolKeys).toContain("folderRead");
    expect(parsed.recommendedBuiltInToolKeys).toContain("schedules");
    expect(parsed.matchKeywords).toContain("review");

    const serialized = serializeSkillToMarkdown({
      autoMatch: true,
      description: parsed.description,
      instructions: parsed.instructions,
      matchKeywords: parsed.matchKeywords,
      recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
      recommendedMcpServerIds: [],
      title: parsed.title,
    });

    const reparsed = parseSkillMarkdown(serialized);
    expect(reparsed.title).toBe(parsed.title);
    expect(reparsed.recommendedBuiltInToolKeys).toEqual(parsed.recommendedBuiltInToolKeys);
  });
});

describe("skill-github", () => {
  it("resolves blob, tree, and raw URLs", () => {
    expect(
      githubBlobToRaw("https://github.com/owner/repo/blob/main/skills/foo/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md");

    expect(
      githubBlobToRaw("https://github.com/owner/repo/tree/main/skills/foo/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md");

    expect(
      githubBlobToRaw("https://github.com/owner/repo/tree/main/skills/foo"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md");

    expect(
      githubBlobToRaw("https://github.com/owner/repo/raw/main/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/SKILL.md");

    expect(
      githubBlobToRaw("https://gist.github.com/octocat/6cad326836d38bd3a7ae"),
    ).toBe("https://gist.githubusercontent.com/octocat/6cad326836d38bd3a7ae/raw");
  });

  it("cleans query params and hash fragments", () => {
    expect(
      resolveSkillMarkdownUrl(
        "https://github.com/owner/repo/blob/main/SKILL.md?plain=1#L10",
      ),
    ).toBe("https://raw.githubusercontent.com/owner/repo/main/SKILL.md");
  });
});
