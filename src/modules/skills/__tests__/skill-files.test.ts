import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSkillFiles } from "../skill-files";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSkillFiles (GitHub source)", () => {
  it("lists a skill directory and downloads related files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.github.com")) {
          return new Response(
            JSON.stringify([
              { name: "SKILL.md", path: "skills/foo/SKILL.md", type: "file" },
              { name: "run.sh", path: "skills/foo/run.sh", type: "file" },
              { name: "guide.md", path: "skills/foo/references/guide.md", type: "file" },
            ]),
            { status: 200 },
          );
        }

        if (url.includes("run.sh")) {
          return new Response("echo hi", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }

        if (url.includes("guide.md")) {
          return new Response("# Guide", {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          });
        }

        if (url.includes("extra.py")) {
          return new Response("print('hi')", {
            status: 200,
            headers: { "Content-Type": "text/x-python" },
          });
        }

        return new Response("", { status: 404 });
      }),
    );

    const files = await fetchSkillFiles({
      sourceUrl:
        "https://github.com/acme/repo/blob/main/skills/foo/SKILL.md",
      referencedPaths: ["scripts/extra.py"],
    });

    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "scripts/extra.py",
      "skills/foo/references/guide.md",
      "skills/foo/run.sh",
    ]);
    expect(files.find((f) => f.path.endsWith("run.sh"))?.content).toBe(
      "echo hi",
    );
  });

  it("does not include SKILL.md itself and bounds file count", async () => {
    const entries = [
      { name: "SKILL.md", path: "skill/SKILL.md", type: "file" },
      ...Array.from({ length: 60 }, (_, i) => ({
        name: `f${i}.md`,
        path: `skill/f${i}.md`,
        type: "file",
      })),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.github.com")) {
          return new Response(JSON.stringify(entries), { status: 200 });
        }

        return new Response("x", {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        });
      }),
    );

    const files = await fetchSkillFiles({
      sourceUrl: "https://github.com/acme/repo/blob/main/skill/SKILL.md",
      referencedPaths: [],
    });

    expect(files.length).toBeLessThanOrEqual(50);
    expect(files.some((f) => f.path.endsWith("SKILL.md"))).toBe(false);
  });
});

describe("fetchSkillFiles (non-GitHub source)", () => {
  it("resolves relative references against the directory of the source URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("guide.md")) {
          return new Response("# Guide", {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          });
        }
        return new Response("", { status: 404 });
      }),
    );

    const files = await fetchSkillFiles({
      sourceUrl: "https://example.com/skills/foo/SKILL.md",
      referencedPaths: ["guide.md", "scripts/run.py"],
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain("guide.md");
    // scripts/run.py returns 404 so it is skipped
    expect(paths).not.toContain("scripts/run.py");
  });
});
