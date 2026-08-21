import { describe, expect, it } from "vitest";

import { globToRegExp, matchesGlob, matchTextLines } from "../search-core";

describe("globToRegExp & matchesGlob", () => {
  it("matches root-level files with **/*.ts pattern", () => {
    expect(matchesGlob("index.ts", ["**/*.ts"])).toBe(true);
    expect(matchesGlob("src/index.ts", ["**/*.ts"])).toBe(true);
    expect(matchesGlob("src/core/index.ts", ["**/*.ts"])).toBe(true);
    expect(matchesGlob("index.js", ["**/*.ts"])).toBe(false);
  });

  it("matches basename when pattern has no path separators", () => {
    expect(matchesGlob("foo.ts", ["*.ts"])).toBe(true);
    expect(matchesGlob("src/modules/foo.ts", ["*.ts"])).toBe(true);
    expect(matchesGlob("src/modules/foo.js", ["*.ts"])).toBe(false);
  });

  it("respects path-specific patterns", () => {
    expect(matchesGlob("src/foo.ts", ["src/*.ts"])).toBe(true);
    expect(matchesGlob("src/bar/foo.ts", ["src/*.ts"])).toBe(false);
    expect(matchesGlob("lib/foo.ts", ["src/*.ts"])).toBe(false);
  });

  it("matches everything when pattern is **", () => {
    expect(matchesGlob("foo.ts", ["**"])).toBe(true);
    expect(matchesGlob("src/a/b/c.ts", ["**"])).toBe(true);
  });

  it("returns true when patterns array is empty", () => {
    expect(matchesGlob("anything.txt", [])).toBe(true);
    expect(matchesGlob("anything.txt")).toBe(true);
  });
});

describe("matchTextLines", () => {
  it("finds matching lines case-insensitively", () => {
    const content = "Hello World\nAnother line\nhello again";
    const matches = matchTextLines({ content, query: "hello", includeContent: true });

    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ line: 1, content: "Hello World" });
    expect(matches[1]).toEqual({ line: 3, content: "hello again" });
  });

  it("returns empty array for empty query", () => {
    const matches = matchTextLines({ content: "Hello", query: "" });
    expect(matches).toEqual([]);
  });
});
