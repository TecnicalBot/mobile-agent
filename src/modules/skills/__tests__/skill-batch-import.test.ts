import { describe, expect, it, vi } from "vitest";

import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillAttachment } from "@/modules/skills/skill-files";
import {
  findSkillImportConflict,
  importSkillBatch,
} from "@/modules/skills/skill-batch-import";

function markdown(title: string) {
  return `---\nname: ${title}\ndescription: ${title} description\n---\n\nUse ${title}.\n`;
}

function attachment(path: string, content: string): SkillAttachment {
  return {
    path,
    content,
    mimeType: path.endsWith(".md") ? "text/markdown" : "text/plain",
    size: content.length,
  };
}

function input(title: string, files?: SkillAttachment[]) {
  const source = markdown(title);
  return {
    path: `${title}/SKILL.md`,
    markdown: source,
    files: files ?? [attachment("SKILL.md", source)],
  };
}

function repository(options: {
  existing?: { id: string; title: string }[];
  failTitle?: string;
} = {}) {
  const created: { id: string; title: string }[] = [];
  const updated: { id: string; title: string }[] = [];
  const repository = {
    list: vi.fn(async () => options.existing ?? []),
    create: vi.fn(async (values: { title: string }) => {
      if (values.title === options.failTitle) {
        throw new Error("disk full");
      }
      const row = { id: `id-${values.title}`, title: values.title };
      created.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, values: { title: string }) => {
      updated.push({ id, title: values.title });
    }),
    _created: created,
    _updated: updated,
  };

  return repository as unknown as SkillRepository & typeof repository;
}

describe("findSkillImportConflict", () => {
  it("matches names case-insensitively and ignores surrounding space", () => {
    expect(
      findSkillImportConflict([{ id: "1", title: "Review" }], "  review "),
    ).toEqual({ id: "1", title: "Review" });
  });
});

describe("importSkillBatch", () => {
  it("imports multiple new skills", async () => {
    const repo = repository();
    const result = await importSkillBatch(repo, [input("alpha"), input("beta")]);

    expect(result.imported.map((item) => item.title)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(result.failed).toEqual([]);
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rejects duplicate names before writing anything", async () => {
    const repo = repository();

    await expect(
      importSkillBatch(repo, [input("alpha"), input("alpha")]),
    ).rejects.toThrow("Multiple selected skills");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("requires confirmation before replacing an existing skill", async () => {
    const repo = repository({ existing: [{ id: "old", title: "alpha" }] });

    await expect(importSkillBatch(repo, [input("alpha")])).rejects.toThrow(
      "already exists",
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("updates the confirmed existing skill instead of creating a duplicate", async () => {
    const repo = repository({ existing: [{ id: "old", title: "alpha" }] });
    const result = await importSkillBatch(repo, [
      { ...input("alpha"), replaceById: "old" },
    ]);

    expect(result.imported).toEqual([
      { path: "alpha/SKILL.md", id: "old", title: "alpha" },
    ]);
    expect(repo.update).toHaveBeenCalledWith(
      "old",
      expect.objectContaining({ title: "alpha" }),
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("continues after one skill fails and reports it", async () => {
    const repo = repository({ failTitle: "beta" });
    const result = await importSkillBatch(repo, [input("alpha"), input("beta")]);

    expect(result.imported.map((item) => item.title)).toEqual(["alpha"]);
    expect(result.failed).toEqual([
      { path: "beta/SKILL.md", title: "beta", error: "disk full" },
    ]);
  });

  it("rejects unsafe supporting file paths before writing", async () => {
    const repo = repository();

    await expect(
      importSkillBatch(repo, [
        input("alpha", [
          attachment("SKILL.md", markdown("alpha")),
          attachment("../escape.sh", "nope"),
        ]),
      ]),
    ).rejects.toThrow("unsafe or duplicate path");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects files with an unknown size", async () => {
    const repo = repository();

    await expect(
      importSkillBatch(repo, [
        input("alpha", [
          { ...attachment("SKILL.md", markdown("alpha")), size: null },
        ]),
      ]),
    ).rejects.toThrow("200 KB limit");
  });
});
