import { desc, eq, isNull } from "drizzle-orm";
import * as Crypto from "expo-crypto";

import { nowIso } from "@/lib/db/repositories/shared";
import type {
  AppDatabase,
  ConversationRepository,
} from "@/lib/db/repositories/types";
import { conversations } from "@/lib/db/schema";

export function createConversationRepository(
  db: AppDatabase,
): ConversationRepository {
  return {
    async create(input) {
      const id = Crypto.randomUUID();
      const timestamp = nowIso();

      await db.insert(conversations).values({
        id,
        title: input.title,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        reasoningEffort: "medium",
        selectedFileIds: [],
        selectedSkillIds: [],
        externalFolderSession: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      });

      const row = (
        await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create conversation");
      }

      return row;
    },
    async getById(id) {
      return (
        (
          await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, id))
            .limit(1)
        )[0] ?? null
      );
    },
    async deleteById(id) {
      await db.delete(conversations).where(eq(conversations.id, id));
    },
    async list() {
      return db
        .select()
        .from(conversations)
        .where(isNull(conversations.archivedAt))
        .orderBy(desc(conversations.updatedAt));
    },
    async updateMetadata(id, input) {
      const current = (
        await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1)
      )[0];

      if (!current) {
        return;
      }

      await db
        .update(conversations)
        .set({
          title: input.title ?? current.title,
          providerId: input.providerId ?? current.providerId,
          modelId: input.modelId ?? current.modelId,
          reasoningEffort: input.reasoningEffort ?? current.reasoningEffort,
          selectedFileIds: input.selectedFileIds ?? current.selectedFileIds,
          selectedSkillIds: input.selectedSkillIds ?? current.selectedSkillIds,
          externalFolderSession:
            input.externalFolderSession !== undefined
              ? input.externalFolderSession
              : current.externalFolderSession,
          updatedAt: input.updatedAt ?? nowIso(),
        })
        .where(eq(conversations.id, id));
    },
  };
}
