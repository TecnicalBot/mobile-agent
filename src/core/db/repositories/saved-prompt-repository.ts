import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { savedPrompts } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  SavedPromptRepository,
} from "@/core/db/repositories/types";

export function createSavedPromptRepository(
  db: AppDatabase,
): SavedPromptRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(savedPrompts).values({
        id,
        title: input.title,
        content: input.content,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create saved prompt");
      }

      return row;
    },
    async delete(id) {
      await db.delete(savedPrompts).where(eq(savedPrompts.id, id));
    },
    async getById(id) {
      return (
        await db
          .select()
          .from(savedPrompts)
          .where(eq(savedPrompts.id, id))
          .limit(1)
      )[0] ?? null;
    },
    async list() {
      return db.select().from(savedPrompts).orderBy(desc(savedPrompts.updatedAt));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(savedPrompts)
        .set({
          content: input.content ?? current.content,
          title: input.title ?? current.title,
          updatedAt: nowIso(),
        })
        .where(eq(savedPrompts.id, id));
    },
  };
}
