import * as Crypto from "expo-crypto";
import { eq, sql } from "drizzle-orm";

import { messages } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase, MessageRepository } from "@/lib/db/repositories/types";

export function createMessageRepository(db: AppDatabase): MessageRepository {
  return {
    async create(input) {
      const id = Crypto.randomUUID();
      const timestamp = nowIso();

      await db.insert(messages).values({
        id,
        conversationId: input.conversationId,
        content: input.content,
        error: input.error ?? null,
        metadata: input.metadata ?? null,
        role: input.role,
        sequence: input.sequence,
        status: input.status,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = (
        await db.select().from(messages).where(eq(messages.id, id)).limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create message");
      }

      return row;
    },
    async getNextSequence(conversationId) {
      const row = (
        await db
          .select({
            nextSequence: sql<number>`coalesce(max(${messages.sequence}), 0) + 1`,
          })
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .limit(1)
      )[0];

      return row?.nextSequence ?? 1;
    },
    async listByConversation(conversationId) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.sequence);
    },
    async listStreaming() {
      return db
        .select()
        .from(messages)
        .where(eq(messages.status, "streaming"))
        .orderBy(messages.updatedAt);
    },
    async recoverInterruptedStreams() {
      await db
        .update(messages)
        .set({
          content: sql<string>`case when ${messages.content} = '' then 'Generation interrupted. Send again to retry.' else ${messages.content} end`,
          error: "Generation interrupted.",
          status: "failed",
          updatedAt: nowIso(),
        })
        .where(eq(messages.status, "streaming"));
    },
    async updateContent(input) {
      await db
        .update(messages)
        .set({
          content: input.content,
          error: input.error ?? null,
          metadata: input.metadata !== undefined ? input.metadata : undefined,
          status: input.status,
          updatedAt: nowIso(),
        })
        .where(eq(messages.id, input.id));
    },
  };
}
