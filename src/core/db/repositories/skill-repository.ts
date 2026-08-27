import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { skillFiles, skills } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type { AppDatabase, SkillRepository } from "@/core/db/repositories/types";

export function createSkillRepository(db: AppDatabase): SkillRepository {
  async function insertFiles(
    skillId: string,
    files: NonNullable<Parameters<SkillRepository["create"]>[0]["files"]>,
  ) {
    if (!files || files.length === 0) {
      return;
    }

    const timestamp = nowIso();

    for (const file of files) {
      await db.insert(skillFiles).values({
        id: file.id ?? Crypto.randomUUID(),
        skillId,
        path: file.path,
        content: file.content,
        mimeType: file.mimeType ?? null,
        size: file.size ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  const factory = (row: typeof skills.$inferSelect & { files?: (typeof skillFiles.$inferSelect)[] }) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    sourceMarkdown: row.sourceMarkdown,
    enabled: row.enabled,
    autoMatch: row.autoMatch,
    matchKeywords: row.matchKeywords,
    recommendedMcpServerIds: row.recommendedMcpServerIds,
    recommendedBuiltInToolKeys: row.recommendedBuiltInToolKeys,
    skillFiles: (row.files ?? []).map((file) => ({
      id: file.id,
      path: file.path,
      content: file.content,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  async function getFiles(skillId: string) {
    return db.select().from(skillFiles).where(eq(skillFiles.skillId, skillId));
  }

  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(skills).values({
        id,
        title: input.title,
        description: input.description ?? null,
        instructions: input.instructions,
        sourceMarkdown: input.sourceMarkdown ?? null,
        enabled: input.enabled ?? true,
        autoMatch: input.autoMatch ?? false,
        matchKeywords: input.matchKeywords ?? [],
        recommendedMcpServerIds: input.recommendedMcpServerIds ?? [],
        recommendedBuiltInToolKeys: input.recommendedBuiltInToolKeys ?? [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await insertFiles(id, input.files ?? []);

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create skill");
      }

      return row;
    },
    async delete(id) {
      await db.delete(skillFiles).where(eq(skillFiles.skillId, id));
      await db.delete(skills).where(eq(skills.id, id));
    },
    async getById(id) {
      const rows = await db.select().from(skillFiles).where(eq(skillFiles.skillId, id));
      const row = (
        await db.select().from(skills).where(eq(skills.id, id)).limit(1)
      )[0];

      if (!row) {
        return null;
      }

      return factory({ ...row, files: rows });
    },
    async list() {
      const rows = await db.select().from(skills).orderBy(desc(skills.updatedAt));
      const fileRows = await db.select().from(skillFiles);
      const filesBySkill = new Map<string, (typeof skillFiles.$inferSelect)[]>();

      for (const file of fileRows) {
        const list = filesBySkill.get(file.skillId) ?? [];
        list.push(file);
        filesBySkill.set(file.skillId, list);
      }

      return rows.map((row) => factory({ ...row, files: filesBySkill.get(row.id) ?? [] }));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(skills)
        .set({
          autoMatch: input.autoMatch ?? current.autoMatch,
          description:
            input.description !== undefined
              ? input.description
              : current.description,
          enabled: input.enabled ?? current.enabled,
          instructions: input.instructions ?? current.instructions,
          matchKeywords: input.matchKeywords ?? current.matchKeywords,
          recommendedBuiltInToolKeys:
            input.recommendedBuiltInToolKeys ??
            current.recommendedBuiltInToolKeys,
          recommendedMcpServerIds:
            input.recommendedMcpServerIds ?? current.recommendedMcpServerIds,
          sourceMarkdown:
            input.sourceMarkdown !== undefined
              ? input.sourceMarkdown
              : current.sourceMarkdown,
          title: input.title ?? current.title,
          updatedAt: nowIso(),
        })
        .where(eq(skills.id, id));

      if (input.files !== undefined) {
        await db.delete(skillFiles).where(eq(skillFiles.skillId, id));
        await insertFiles(id, input.files);
      }
    },
    async listFilesForSkill(skillId) {
      const rows = await getFiles(skillId);

      return rows.map((file) => ({
        id: file.id,
        path: file.path,
        content: file.content,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      }));
    },
    async deleteFilesForSkill(skillId) {
      await db.delete(skillFiles).where(eq(skillFiles.skillId, skillId));
    },
  };
}
