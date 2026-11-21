import { Zip, ZipDeflate, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseSkillArchive } from "../skill-archive";

function skillMarkdown(name: string, instructions = "Follow the steps.") {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\n${instructions}\n`;
}

function buildArchive(files: Record<string, string | Uint8Array>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        typeof content === "string" ? strToU8(content) : content,
      ]),
    ),
  );
}

// Streaming writers leave sizes in data descriptors instead of local headers.
function buildStreamingArchive(files: Record<string, string>) {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) {
      throw error;
    }
    chunks.push(chunk);
  });

  for (const [path, content] of Object.entries(files)) {
    const file = new ZipDeflate(path);
    zip.add(file);
    file.push(strToU8(content), true);
  }
  zip.end();

  const output = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

describe("parseSkillArchive", () => {
  it("reads a skill at the archive root with text and binary files", async () => {
    const [skill] = await parseSkillArchive(
      buildArchive({
        "SKILL.md": skillMarkdown("Root Skill"),
        "scripts/run.sh": "echo hi",
        "assets/icon.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    );

    expect(skill?.path).toBe("SKILL.md");
    expect(skill?.error).toBeNull();
    expect(skill?.parsed?.title).toBe("Root Skill");
    expect(skill?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
      "assets/icon.png",
    ]);
    expect(
      skill?.files.find((file) => file.path === "scripts/run.sh")?.content,
    ).toBe("echo hi");
    expect(
      skill?.files.find((file) => file.path === "assets/icon.png")?.mimeType,
    ).toBe("image/png");
    expect(
      skill?.files.find((file) => file.path === "assets/icon.png")?.content,
    ).toBe("iVBORw==");
  });

  it("finds multiple nested skills and keeps their files separate", async () => {
    const skills = await parseSkillArchive(
      buildArchive({
        "alpha/SKILL.md": skillMarkdown("Alpha"),
        "alpha/scripts/a.sh": "a",
        "beta/SKILL.md": skillMarkdown("Beta"),
        "beta/references/b.md": "# B",
      }),
    );

    expect(skills.map((skill) => skill.path)).toEqual([
      "alpha/SKILL.md",
      "beta/SKILL.md",
    ]);
    expect(skills[0]?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "scripts/a.sh",
    ]);
    expect(skills[1]?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/b.md",
    ]);
  });

  it("assigns files to the deepest skill directory", async () => {
    const skills = await parseSkillArchive(
      buildArchive({
        "outer/SKILL.md": skillMarkdown("Outer"),
        "outer/readme.md": "outer",
        "outer/inner/SKILL.md": skillMarkdown("Inner"),
        "outer/inner/inner.md": "inner",
      }),
    );

    expect(skills.map((skill) => skill.path)).toEqual([
      "outer/SKILL.md",
      "outer/inner/SKILL.md",
    ]);
    expect(skills[0]?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "readme.md",
    ]);
    expect(skills[1]?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "inner.md",
    ]);
  });

  it("handles explicit directory entries", async () => {
    const skills = await parseSkillArchive(
      buildArchive({
        "foo/": "",
        "foo/SKILL.md": skillMarkdown("Directory"),
        "foo/scripts/": "",
        "foo/scripts/a.sh": "a",
      }),
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "scripts/a.sh",
    ]);
  });

  it("ignores macOS metadata files", async () => {
    const skills = await parseSkillArchive(
      buildArchive({
        "__MACOSX/foo/SKILL.md": skillMarkdown("Hidden"),
        "__MACOSX/foo/.DS_Store": new Uint8Array([1, 2, 3]),
        "foo/SKILL.md": skillMarkdown("Visible"),
      }),
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]?.parsed?.title).toBe("Visible");
  });

  it("reports an invalid SKILL.md without hiding valid skills", async () => {
    const skills = await parseSkillArchive(
      buildArchive({
        "bad/SKILL.md": "not a skill",
        "good/SKILL.md": skillMarkdown("Good"),
      }),
    );

    expect(skills[0]?.error).toContain("not a SKILL.md");
    expect(skills[1]?.parsed?.title).toBe("Good");
  });

  it("reports oversized supporting files as a skill error", async () => {
    const [skill] = await parseSkillArchive(
      buildArchive({
        "SKILL.md": skillMarkdown("Large"),
        "big.bin": new Uint8Array(200_001),
      }),
    );

    expect(skill?.error).toContain("200 KB");
    expect(skill?.files).toEqual([]);
  });

  it("rejects archives without SKILL.md", async () => {
    await expect(
      parseSkillArchive(buildArchive({ "readme.md": "hello" })),
    ).rejects.toThrow("No SKILL.md files");
  });

  it("rejects archives with too many skills", async () => {
    const files: Record<string, string> = {};

    for (let index = 0; index < 51; index += 1) {
      files[`skill-${index}/SKILL.md`] = skillMarkdown(`Skill ${index}`);
    }

    await expect(parseSkillArchive(buildArchive(files))).rejects.toThrow(
      "too many skills",
    );
  });

  it("reports a skill with too many files", async () => {
    const files: Record<string, string> = {
      "SKILL.md": skillMarkdown("Many"),
    };

    for (let index = 0; index < 50; index += 1) {
      files[`file-${index}.txt`] = "x";
    }

    const [skill] = await parseSkillArchive(buildArchive(files));

    expect(skill?.error).toContain("50-file limit");
    expect(skill?.files).toEqual([]);
  });

  it("rejects corrupt archives", async () => {
    await expect(
      parseSkillArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])),
    ).rejects.toThrow("Could not read the ZIP");
  });

  it("rejects path traversal", async () => {
    await expect(
      parseSkillArchive(
        buildArchive({
          "SKILL.md": skillMarkdown("Escape"),
          "../evil.txt": "nope",
        }),
      ),
    ).rejects.toThrow("unsafe file path");
  });

  it("reads an archive written with streaming data descriptors", async () => {
    const [skill] = await parseSkillArchive(
      buildStreamingArchive({
        "SKILL.md": skillMarkdown("Streamed"),
        "scripts/run.sh": "echo streamed",
      }),
    );

    expect(skill?.parsed?.title).toBe("Streamed");
    expect(skill?.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
    ]);
    expect(
      skill?.files.find((file) => file.path === "scripts/run.sh")?.content,
    ).toBe("echo streamed");
  });

  it("rejects two SKILL.md files in the same directory", async () => {
    await expect(
      parseSkillArchive(
        buildArchive({
          "foo/SKILL.md": skillMarkdown("Upper"),
          "foo/skill.md": skillMarkdown("Lower"),
        }),
      ),
    ).rejects.toThrow("More than one SKILL.md");
  });
});
