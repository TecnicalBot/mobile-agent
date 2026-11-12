import { desc, eq, isNull } from "drizzle-orm";
import * as Crypto from "expo-crypto";

import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ConversationRepository,
} from "@/core/db/repositories/types";
import { conversations } from "@/core/db/schema";

export function createConversationRepository(
  db: AppDatabase,
): ConversationRepository {
  return {
    async create(input) {
      const id = input.id ?? Crypto.randomUUID();
      const timestamp = nowIso();

      await db.insert(conversations).values({
        id,
        title: input.title,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        agentId: input.agentId ?? null,
        pinnedAt: input.pinnedAt ?? null,
        reasoningEffort: input.reasoningEffort ?? "medium",
        agentMode: input.agentMode ?? "build",
        selectedFileIds: input.selectedFileIds ?? [],
        selectedMcpServerIds:
          input.selectedMcpServerIds !== undefined
            ? input.selectedMcpServerIds
            : null,
        selectedSkillIds: input.selectedSkillIds ?? [],
        externalFolderSession: input.externalFolderSession ?? null,
        parentConversationId: input.parentConversationId ?? null,
        rootConversationId: input.rootConversationId ?? null,
        relationshipToParent: input.relationshipToParent ?? null,
        createdAt: input.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
        archivedAt: input.archivedAt ?? null,
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
        .orderBy(desc(conversations.pinnedAt), desc(conversations.updatedAt));
    },
    async updateMetadata(id, input) {
      // Drizzle ignores undefined fields. Do not read and rewrite unrelated
      // metadata: a concurrent title update could restore a cleared draft.
      await db
        .update(conversations)
        .set({
          title: input.title ?? undefined,
          providerId: input.providerId ?? undefined,
          modelId: input.modelId ?? undefined,
          pinnedAt: input.pinnedAt,
          reasoningEffort: input.reasoningEffort ?? undefined,
          agentId: input.agentId,
          agentMode: input.agentMode ?? undefined,
          selectedFileIds: input.selectedFileIds ?? undefined,
          selectedMcpServerIds: input.selectedMcpServerIds,
          selectedSkillIds: input.selectedSkillIds ?? undefined,
          externalFolderSession: input.externalFolderSession,
          updatedAt: input.updatedAt ?? nowIso(),
        })
        .where(eq(conversations.id, id));
    },
  };
}
