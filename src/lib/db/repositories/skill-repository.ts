import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { skills } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase, SkillRepository } from "@/lib/db/repositories/types";

export function createSkillRepository(db: AppDatabase): SkillRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(skills).values({
        id,
        title: input.title,
        description: input.description ?? null,
        instructions: input.instructions,
        enabled: input.enabled ?? true,
        autoMatch: input.autoMatch ?? false,
        matchKeywords: input.matchKeywords ?? [],
        recommendedMcpServerIds: input.recommendedMcpServerIds ?? [],
        recommendedBuiltInToolKeys: input.recommendedBuiltInToolKeys ?? [],
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
      await db.delete(skills).where(eq(skills.id, id));
    },
    async getById(id) {
      return (
        await db.select().from(skills).where(eq(skills.id, id)).limit(1)
      )[0] ?? null;
    },
    async list() {
      return db.select().from(skills).orderBy(desc(skills.updatedAt));
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
          title: input.title ?? current.title,
          updatedAt: nowIso(),
        })
        .where(eq(skills.id, id));
    },
  };
}
