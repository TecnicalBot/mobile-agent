import { describe, expect, it } from "vitest";

import {
  sanitizeFileName,
  sanitizeRelPath,
} from "@/modules/content/paths";

describe("content files sanitizers", () => {
  it("sanitizes safe relative paths", () => {
    expect(sanitizeRelPath("run.sh")).toBe("run.sh");
    expect(sanitizeRelPath("scripts/run.sh")).toBe("scripts/run.sh");
    expect(sanitizeRelPath("  references/guide.md  ")).toBe(
      "references/guide.md",
    );
  });

  it("rejects unsafe relative paths", () => {
    expect(sanitizeRelPath("")).toBeNull();
    expect(sanitizeRelPath("  ")).toBeNull();
    expect(sanitizeRelPath("/abs/path.txt")).toBeNull();
    expect(sanitizeRelPath("https://example.com/file.txt")).toBeNull();
    expect(sanitizeRelPath("../escape.txt")).toBeNull();
    expect(sanitizeRelPath("a/../../b.txt")).toBeNull();
    expect(sanitizeRelPath("a/./b.txt")).toBeNull();
  });

  it("sanitizes agent doc file names", () => {
    expect(sanitizeFileName("guide.md")).toBe("guide.md");
    expect(sanitizeFileName("My Document.md")).toBe("My-Document.md");
    expect(sanitizeFileName("../secret.md")).toBe("secret.md");
    expect(sanitizeFileName("a/b\\c")).toBe("a-b-c");
    expect(sanitizeFileName("")).toBe("doc");
    expect(sanitizeFileName("   ")).toBe("doc");
  });
});