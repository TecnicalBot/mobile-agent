import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig } from "@/core/types/app-state";
import { syncSkillFromSource } from "../skill-sync";

const SOURCE_URL = "https://example.com/skills/foo/SKILL.md";

const OLD_MARKDOWN = `---
name: demo
description: Demo skill
---
Old instructions

See [guide](guide.md).
`;

const NEW_MARKDOWN = `---
name: demo
description: Demo skill
---
New instructions

See [guide](guide.md) and \`scripts/run.sh\`.
`;

const RENAMED_MARKDOWN = `---
name: demo
description: Demo skill
---
New instructions

See \`scripts/run.sh\`.
`;

function createSkill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: "skill-1",
    title: "demo",
    description: "Demo skill",
    instructions: "Old instructions",
    sourceMarkdown: OLD_MARKDOWN,
    enabled: false,
    autoMatch: true,
    matchKeywords: [],
    recommendedMcpServerIds: [],
    recommendedBuiltInToolKeys: [],
    skillFiles: [
      {
        id: "guide.md",
        path: "guide.md",
        content: "# Old guide",
        mimeType: "text/markdown",
        size: 11,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "notes/local.md",
        path: "notes/local.md",
        content: "my notes",
        mimeType: "text/markdown",
        size: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    source: {
      url: SOURCE_URL,
      extraFiles: [],
      filePaths: ["guide.md"],
      syncedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createRepository(skill: SkillConfig | null) {
  let current = skill;
  const updates: Parameters<SkillRepository["update"]>[1][] = [];

  const repository = {
    async getById(id: string) {
      return current?.id === id ? current : null;
    },
    async update(id: string, input: Parameters<SkillRepository["update"]>[1]) {
      updates.push(input);

      if (!current || current.id !== id) {
        return;
      }

      if (input.files) {
        current = {
          ...current,
          skillFiles: input.files.map((file) => ({
            id: file.path,
            path: file.path,
            content: file.content,
            mimeType: file.mimeType ?? null,
            size: file.size ?? null,
            createdAt: current!.createdAt,
            updatedAt: current!.updatedAt,
          })),
        };
      }

      if (input.sourceMarkdown) {
        current = { ...current, sourceMarkdown: input.sourceMarkdown };
      }

      if (input.source !== undefined) {
        current = { ...current, source: input.source };
      }
    },
  } as unknown as SkillRepository;

  return { repository, updates, current: () => current };
}

function stubDownloads(markdown: string, files: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === SOURCE_URL) {
        return new Response(markdown, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        });
      }

      const path = url.replace("https://example.com/skills/foo/", "");

      if (path in files) {
        return new Response(files[path], {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response("", { status: 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncSkillFromSource", () => {
  it("refreshes instructions and source files while keeping local files", async () => {
    stubDownloads(NEW_MARKDOWN, {
      "guide.md": "# New guide",
      "scripts/run.sh": "echo new",
    });

    const state = createRepository(createSkill());
    const result = await syncSkillFromSource(state.repository, "skill-1");

    expect(result.updated).toBe(true);
    expect(state.updates).toHaveLength(1);

    const update = state.updates[0]!;
    expect(update.sourceMarkdown).toBe(NEW_MARKDOWN);
    expect(update.files?.map((file) => file.path).sort()).toEqual([
      "guide.md",
      "notes/local.md",
      "scripts/run.sh",
    ]);
    expect(
      update.files?.find((file) => file.path === "guide.md")?.content,
    ).toBe("# New guide");
    expect(
      update.files?.find((file) => file.path === "notes/local.md")?.content,
    ).toBe("my notes");
    expect(update.source?.filePaths.sort()).toEqual([
      "guide.md",
      "scripts/run.sh",
    ]);
    expect(update.enabled).toBeUndefined();
    expect(result.skill.enabled).toBe(false);
  });

  it("removes source files that no longer exist remotely", async () => {
    stubDownloads(RENAMED_MARKDOWN, { "scripts/run.sh": "echo new" });

    const state = createRepository(createSkill());
    await syncSkillFromSource(state.repository, "skill-1");

    const paths = state.updates[0]?.files?.map((file) => file.path).sort();
    expect(paths).toEqual(["notes/local.md", "scripts/run.sh"]);
  });

  it("reports no change without rewriting content", async () => {
    stubDownloads(OLD_MARKDOWN, { "guide.md": "# Old guide" });

    const state = createRepository(createSkill());
    const result = await syncSkillFromSource(state.repository, "skill-1");

    expect(result.updated).toBe(false);
    expect(state.updates[0]?.sourceMarkdown).toBeUndefined();
    expect(state.updates[0]?.files).toBeUndefined();
    expect(state.updates[0]?.source?.syncedAt).not.toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("rejects skills without a saved source", async () => {
    const state = createRepository(createSkill({ source: null }));

    await expect(
      syncSkillFromSource(state.repository, "skill-1"),
    ).rejects.toThrow(/re-import/i);
  });

  it("leaves the installed skill untouched when a download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === SOURCE_URL) {
          return new Response(NEW_MARKDOWN, {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          });
        }
        return new Response("", { status: 429 });
      }),
    );

    const state = createRepository(createSkill());

    await expect(
      syncSkillFromSource(state.repository, "skill-1"),
    ).rejects.toThrow(/guide\.md/);
    expect(state.updates).toHaveLength(0);
  });
});
