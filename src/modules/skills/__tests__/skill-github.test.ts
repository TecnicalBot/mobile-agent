import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSkillMarkdownFromUrl,
  githubBlobToRaw,
  resetBranchCacheForTests,
  resolveSkillMarkdownUrl,
} from "../skill-github";

afterEach(() => {
  vi.unstubAllGlobals();
  resetBranchCacheForTests();
});

describe("githubBlobToRaw", () => {
  it("rewrites gist URLs to raw", () => {
    expect(githubBlobToRaw("https://gist.github.com/user/abc123/raw")).toBe(
      "https://gist.githubusercontent.com/user/abc123/raw",
    );
  });

  it("keeps raw.githubusercontent URLs", () => {
    expect(
      githubBlobToRaw("https://github.com/acme/repo/raw/main/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/acme/repo/main/SKILL.md");
  });

  it("preserves branch and .md path for blob URLs", () => {
    expect(
      githubBlobToRaw("https://github.com/acme/repo/blob/master/docs/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/acme/repo/master/docs/SKILL.md");
  });

  it("appends SKILL.md for non-md blob paths", () => {
    expect(
      githubBlobToRaw("https://github.com/acme/repo/blob/main/skills/foo"),
    ).toBe("https://raw.githubusercontent.com/acme/repo/main/skills/foo/SKILL.md");
  });

  it("marks bare repo URLs with a branch placeholder", () => {
    expect(githubBlobToRaw("https://github.com/acme/repo")).toBe(
      "https://raw.githubusercontent.com/acme/repo/__DEFAULT_BRANCH__/SKILL.md",
    );
  });
});

describe("resolveSkillMarkdownUrl", () => {
  it("throws for empty input", () => {
    expect(() => resolveSkillMarkdownUrl("  ")).toThrow("Enter a URL");
  });

  it("throws for non-http input", () => {
    expect(() => resolveSkillMarkdownUrl("not-a-url")).toThrow(
      "Enter a valid http(s) URL",
    );
  });

  it("returns non-github urls as-is", () => {
    expect(resolveSkillMarkdownUrl("https://example.com/x/SKILL.md")).toBe(
      "https://example.com/x/SKILL.md",
    );
  });
});

describe("fetchSkillMarkdownFromUrl error clarity", () => {
  it("reports 403/429 with a rate-limit hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate", { status: 429 })),
    );

    await expect(
      fetchSkillMarkdownFromUrl("https://example.com/SKILL.md"),
    ).rejects.toThrow(/rate limit/i);
  });

  it("reports generic non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 404 })),
    );

    await expect(
      fetchSkillMarkdownFromUrl("https://example.com/SKILL.md"),
    ).rejects.toThrow("HTTP 404");
  });

  it("rejects HTML pages with an actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><html><body>GitHub page</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    await expect(
      fetchSkillMarkdownFromUrl("https://example.com/SKILL.md"),
    ).rejects.toThrow(/did not return a markdown file/i);
  });

  it("accepts valid markdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("---\nname: foo\n---\nInstructions", {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          }),
      ),
    );

    const result = await fetchSkillMarkdownFromUrl("https://example.com/SKILL.md");
    expect(result.content).toContain("Instructions");
  });
});

describe("resolveDefaultBranch", () => {
  it("uses the API default branch for bare repos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.github.com")) {
          return new Response(JSON.stringify({ default_branch: "trunk" }), {
            status: 200,
          });
        }
        return new Response("", { status: 200 });
      }),
    );

    const result = await fetchSkillMarkdownFromUrl("https://github.com/acme/repo");
    expect(result.content).toBe("");
    // The resolved raw URL should use "trunk" as the branch.
    const calls = vi.mocked(fetch).mock.calls as [string][];
    const rawCall = calls.find(([u]) => u.includes("raw.githubusercontent.com"));
    expect(rawCall?.[0]).toBe(
      "https://raw.githubusercontent.com/acme/repo/trunk/SKILL.md",
    );
  });
});
