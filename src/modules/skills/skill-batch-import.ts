import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig } from "@/core/types/app-state";
import { sanitizeRelPath } from "@/modules/content/paths";
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_MAX_COUNT,
  SKILL_FILE_MAX_TOTAL_BYTES,
  type SkillAttachment,
} from "@/modules/skills/skill-files";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";

export type SkillBatchImportInput = {
  path: string;
  markdown: string;
  files: SkillAttachment[];
  replaceById?: string | null;
};

export type SkillBatchImportResult = {
  imported: { path: string; id: string; title: string }[];
  failed: { path: string; title: string; error: string }[];
};

export function skillImportName(title: string) {
  return title.trim().toLowerCase();
}

export function findSkillImportConflict(
  skills: Pick<SkillConfig, "id" | "title">[],
  title: string,
) {
  return skills.find((skill) => skillImportName(skill.title) === skillImportName(title));
}

/** Validate the whole selection before writing, then report per-skill failures. */
export async function importSkillBatch(
  repository: SkillRepository,
  inputs: SkillBatchImportInput[],
): Promise<SkillBatchImportResult> {
  const existing = await repository.list();
  const names = new Set<string>();
  const paths = new Set<string>();
  const prepared = inputs.map((input) => {
    const parsed = parseSkillMarkdown(input.markdown);
    const name = skillImportName(parsed.title);
    if (names.has(name)) {
      throw new Error(`Multiple selected skills are named "${parsed.title}". Select only one.`);
    }
    if (paths.has(input.path)) {
      throw new Error(`The skill ${input.path} was selected more than once.`);
    }
    names.add(name);
    paths.add(input.path);
    const conflict = findSkillImportConflict(existing, parsed.title);
    if (conflict && conflict.id !== input.replaceById) {
      throw new Error(`A skill named "${parsed.title}" already exists. Confirm its replacement before importing.`);
    }
    if (input.replaceById && (!conflict || conflict.id !== input.replaceById)) {
      throw new Error(`The skill to replace for "${parsed.title}" has changed. Review the selection again.`);
    }
    const filePaths = new Set<string>();
    let totalBytes = 0;
    if (input.files.length > SKILL_FILE_MAX_COUNT) {
      throw new Error(`"${parsed.title}" exceeds the ${SKILL_FILE_MAX_COUNT}-file limit.`);
    }
    for (const file of input.files) {
      if (sanitizeRelPath(file.path) !== file.path || file.path.includes("\\") || filePaths.has(file.path)) {
        throw new Error(`"${parsed.title}" contains an unsafe or duplicate path: ${file.path}`);
      }
      filePaths.add(file.path);
      if (file.size === null || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > SKILL_FILE_MAX_BYTES) {
        throw new Error(`"${parsed.title}" contains a file exceeding the 200 KB limit.`);
      }
      totalBytes += file.size;
    }
    if (totalBytes > SKILL_FILE_MAX_TOTAL_BYTES) {
      throw new Error(`"${parsed.title}" exceeds the 1 MB total file limit.`);
    }
    return { input, parsed };
  });

  const result: SkillBatchImportResult = { imported: [], failed: [] };
  for (const { input, parsed } of prepared) {
    try {
      const values = {
        autoMatch: parsed.autoMatch,
        description: parsed.description,
        enabled: true,
        files: input.files,
        instructions: parsed.instructions,
        matchKeywords: parsed.matchKeywords,
        recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
        recommendedMcpServerIds: parsed.recommendedMcpServerIds,
        source: input.replaceById ? null : undefined,
        sourceMarkdown: input.markdown,
        title: parsed.title,
      };
      let id: string;
      if (input.replaceById) {
        await repository.update(input.replaceById, values);
        id = input.replaceById;
      } else {
        id = (await repository.create(values)).id;
      }
      result.imported.push({ path: input.path, id, title: parsed.title });
    } catch (error) {
      result.failed.push({
        path: input.path,
        title: parsed.title,
        error: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }
  return result;
}
