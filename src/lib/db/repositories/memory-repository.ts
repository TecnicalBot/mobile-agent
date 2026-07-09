import * as Crypto from "expo-crypto";
import { desc, eq, isNull } from "drizzle-orm";

import { memories } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase, MemoryRepository } from "@/lib/db/repositories/types";

export function createMemoryRepository(db: AppDatabase): MemoryRepository {
  return {
    async archive(id) {
      await db
        .update(memories)
        .set({
          archivedAt: nowIso(),
          enabled: false,
          updatedAt: nowIso(),
        })
        .where(eq(memories.id, id));
    },
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(memories).values({
        id,
        content: input.content,
        enabled: input.enabled ?? true,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create memory");
      }

      return row;
    },
    async getById(id) {
      return (
        await db.select().from(memories).where(eq(memories.id, id)).limit(1)
      )[0] ?? null;
    },
    async list(input) {
      const query = db.select().from(memories);

      if (input?.includeArchived) {
        return query.orderBy(desc(memories.updatedAt));
      }

      return query
        .where(isNull(memories.archivedAt))
        .orderBy(desc(memories.updatedAt));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(memories)
        .set({
          content: input.content ?? current.content,
          enabled: input.enabled ?? current.enabled,
          sourceConversationId:
            input.sourceConversationId !== undefined
              ? input.sourceConversationId
              : current.sourceConversationId,
          sourceMessageId:
            input.sourceMessageId !== undefined
              ? input.sourceMessageId
              : current.sourceMessageId,
          updatedAt: nowIso(),
        })
        .where(eq(memories.id, id));
    },
  };
}
