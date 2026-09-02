import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachmentFromBytes,
  fetchSkillFiles,
  isBinaryMimeType,
  pickSkillFile,
} from "../skill-files";

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

describe("fetchSkillFiles extraFiles", () => {
  it("merges extra file URLs into a GitHub skill", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.github.com")) {
          return new Response(
            JSON.stringify([
              { name: "SKILL.md", path: "skills/foo/SKILL.md", type: "file" },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("templates/note.md")) {
          return new Response("# Note", {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          });
        }
        return new Response("", { status: 404 });
      }),
    );

    const files = await fetchSkillFiles({
      sourceUrl: "https://github.com/acme/repo/blob/main/skills/foo/SKILL.md",
      referencedPaths: [],
      extraFiles: [
        "https://raw.githubusercontent.com/acme/repo/main/skills/foo/templates/note.md",
      ],
    });

    const note = files.find((f) => f.path.endsWith("templates/note.md"));
    expect(note).toBeDefined();
    expect(note?.content).toBe("# Note");
  });

  it("fetches absolute extra file URLs for non-GitHub sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("cdn.example.com")) {
          return new Response("body{}", {
            status: 200,
            headers: { "Content-Type": "text/css" },
          });
        }
        return new Response("", { status: 404 });
      }),
    );

    const files = await fetchSkillFiles({
      sourceUrl: "https://example.com/SKILL.md",
      referencedPaths: ["guide.md"],
      extraFiles: ["https://cdn.example.com/style.css"],
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain("style.css");
  });
});

describe("isBinaryMimeType", () => {
  it("treats text-like types as non-binary", () => {
    expect(isBinaryMimeType("text/markdown")).toBe(false);
    expect(isBinaryMimeType("application/javascript")).toBe(false);
    expect(isBinaryMimeType("application/json")).toBe(false);
    expect(isBinaryMimeType("image/svg+xml")).toBe(false);
    expect(isBinaryMimeType("text/plain")).toBe(false);
  });

  it("treats unknown/image/zip as binary", () => {
    expect(isBinaryMimeType("image/png")).toBe(true);
    expect(isBinaryMimeType("application/zip")).toBe(true);
    expect(isBinaryMimeType(null)).toBe(true);
  });
});

describe("attachmentFromBytes", () => {
  it("decodes text content", () => {
    const attachment = attachmentFromBytes({
      path: "guide.md",
      bytes: new TextEncoder().encode("# Guide"),
      mimeType: "text/markdown",
    });

    expect(attachment?.content).toBe("# Guide");
    expect(attachment?.size).toBe(7);
  });

  it("encodes binary content as base64", () => {
    const attachment = attachmentFromBytes({
      path: "icon.png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });

    expect(attachment?.content).toBe("iVBORw==");
    expect(attachment?.mimeType).toBe("image/png");
  });

  it("rejects files over the size cap", () => {
    const attachment = attachmentFromBytes({
      path: "big.bin",
      bytes: new Uint8Array(200_001),
      mimeType: "application/octet-stream",
    });

    expect(attachment).toBeNull();
  });
});

describe("pickSkillFile", () => {
  it("prefers a file literally named SKILL.md", () => {
    const picked = pickSkillFile([
      { name: "readme.md", content: "---\nname: other\n---\nb" },
      { name: "SKILL.md", content: "---\nname: real\n---\na" },
    ]);

    expect(picked).toBe("SKILL.md");
  });

  it("falls back to the first parseable markdown skill", () => {
    const picked = pickSkillFile([
      { name: "notes.txt", content: "not a skill" },
      { name: "start.md", content: "---\nname: fallback\n---\nbody" },
    ]);

    expect(picked).toBe("start.md");
  });

  it("returns null when nothing is a skill", () => {
    expect(pickSkillFile([{ name: "x.txt", content: "hi" }])).toBeNull();
  });
});
