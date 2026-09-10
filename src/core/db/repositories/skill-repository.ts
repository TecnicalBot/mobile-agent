import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { skills } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type { AppDatabase, SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig, SkillFile } from "@/core/types/app-state";
import {
  parseSkillMarkdown,
  serializeSkillToMarkdown,
} from "@/modules/skills/skill-markdown";
import {
  SKILL_FILES_DIR,
  SKILL_MARKDOWN_FILE,
  deleteEntityDir,
  deleteEntitySubdir,
  readEntityFile,
  readSkillFilesManifest,
  sanitizeRelPath,
  writeEntityFile,
  writeSkillFilesManifest,
} from "@/modules/content/files";
import type { SkillFilesManifest } from "@/modules/content/files";

export function createSkillRepository(db: AppDatabase): SkillRepository {
  function writeMarkdown(id: string, markdown: string): string {
    return writeEntityFile("skills", id, [SKILL_MARKDOWN_FILE], markdown);
  }

  function writeSupportingFiles(
    id: string,
    files: NonNullable<Parameters<SkillRepository["create"]>[0]["files"]>,
    timestamp: string,
  ) {
    deleteEntitySubdir("skills", id, SKILL_FILES_DIR);

    const manifestFiles: SkillFilesManifest["files"] = [];

    for (const file of files) {
      const path = sanitizeRelPath(file.path);

      if (!path) {
        continue;
      }

      writeEntityFile(
        "skills",
        id,
        [SKILL_FILES_DIR, ...path.split("/")],
        file.content,
      );
      manifestFiles.push({
        path,
        mimeType: file.mimeType ?? null,
        size: file.size ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    writeSkillFilesManifest(id, manifestFiles);
  }

  async function readSupportingFiles(id: string): Promise<SkillFile[]> {
    const manifest = await readSkillFilesManifest(id);

    if (!manifest) {
      return [];
    }

    const result: SkillFile[] = [];

    for (const meta of manifest.files) {
      const content = await readEntityFile(
        "skills",
        id,
        [SKILL_FILES_DIR, ...meta.path.split("/")],
      );

      if (content === null) {
        continue;
      }

      result.push({
        id: meta.path,
        path: meta.path,
        content,
        mimeType: meta.mimeType,
        size: meta.size,
        createdAt: meta.createdAt ?? "",
        updatedAt: meta.updatedAt ?? "",
      });
    }

    return result;
  }

  async function readConfig(row: typeof skills.$inferSelect): Promise<SkillConfig | null> {
    const markdown = await readEntityFile("skills", row.id, [SKILL_MARKDOWN_FILE]);

    if (markdown === null) {
      return null;
    }

    let parsed: ReturnType<typeof parseSkillMarkdown>;

    try {
      parsed = parseSkillMarkdown(markdown);
    } catch {
      return null;
    }

    return {
      id: row.id,
      title: parsed.title,
      description: parsed.description,
      instructions: parsed.instructions,
      sourceMarkdown: markdown,
      enabled: row.enabled,
      autoMatch: parsed.autoMatch,
      matchKeywords: parsed.matchKeywords,
      recommendedMcpServerIds: parsed.recommendedMcpServerIds,
      recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
      skillFiles: await readSupportingFiles(row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      const markdown =
        input.sourceMarkdown !== undefined && input.sourceMarkdown !== null
          ? input.sourceMarkdown
          : serializeSkillToMarkdown({
              autoMatch: input.autoMatch ?? false,
              description: input.description ?? null,
              instructions: input.instructions,
              matchKeywords: input.matchKeywords ?? [],
              recommendedBuiltInToolKeys:
                input.recommendedBuiltInToolKeys ?? [],
              recommendedMcpServerIds: input.recommendedMcpServerIds ?? [],
              title: input.title,
            });

      const filePath = writeMarkdown(id, markdown);

      if (input.files && input.files.length > 0) {
        writeSupportingFiles(id, input.files, timestamp);
      }

      await db.insert(skills).values({
        id,
        filePath,
        enabled: input.enabled ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create skill");
      }

      return row;
    },
    async delete(id) {
      deleteEntityDir("skills", id);
      await db.delete(skills).where(eq(skills.id, id));
    },
    async getById(id) {
      const row = (
        await db.select().from(skills).where(eq(skills.id, id)).limit(1)
      )[0];

      if (!row) {
        return null;
      }

      return readConfig(row);
    },
    async list() {
      const rows = await db.select().from(skills).orderBy(desc(skills.updatedAt));
      const result: SkillConfig[] = [];

      for (const row of rows) {
        const config = await readConfig(row);

        if (config) {
          result.push(config);
        }
      }

      return result;
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      const markdown =
        input.sourceMarkdown !== undefined && input.sourceMarkdown !== null
          ? input.sourceMarkdown
          : serializeSkillToMarkdown({
              autoMatch: input.autoMatch ?? current.autoMatch,
              description:
                input.description !== undefined
                  ? input.description
                  : current.description,
              instructions: input.instructions ?? current.instructions,
              matchKeywords: input.matchKeywords ?? current.matchKeywords,
              recommendedBuiltInToolKeys:
                input.recommendedBuiltInToolKeys ??
                current.recommendedBuiltInToolKeys,
              recommendedMcpServerIds:
                input.recommendedMcpServerIds ??
                current.recommendedMcpServerIds,
              title: input.title ?? current.title,
            });

      writeMarkdown(id, markdown);

      if (input.files !== undefined) {
        writeSupportingFiles(id, input.files, nowIso());
      }

      await db
        .update(skills)
        .set({
          enabled: input.enabled ?? current.enabled,
          updatedAt: nowIso(),
        })
        .where(eq(skills.id, id));
    },
    async listFilesForSkill(skillId) {
      return readSupportingFiles(skillId);
    },
    async deleteFilesForSkill(skillId) {
      deleteEntitySubdir("skills", skillId, SKILL_FILES_DIR);
      writeSkillFilesManifest(skillId, []);
    },
  };
}