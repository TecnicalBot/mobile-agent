import * as Crypto from "expo-crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import { agentRuns } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AgentRunStatus } from "@/types/app-state";
import type {
  AgentRunRepository,
  AppDatabase,
} from "@/lib/db/repositories/types";

const ACTIVE_RUN_STATUSES: AgentRunStatus[] = [
  "queued",
  "running",
  "waiting_for_approval",
  "resumable",
];

export function createAgentRunRepository(db: AppDatabase): AgentRunRepository {
  return {
    async create(input) {
      const id = input.id ?? Crypto.randomUUID();
      const timestamp = input.updatedAt ?? nowIso();

      await db.insert(agentRuns).values({
        id,
        conversationId: input.conversationId,
        status: input.status,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        providerId: input.providerId,
        modelId: input.modelId,
        input: input.input,
        fileContextSource: input.fileContextSource ?? null,
        selectedFileIds: input.selectedFileIds ?? [],
        externalFolderSession: input.externalFolderSession ?? null,
        startedAt: input.startedAt ?? timestamp,
        updatedAt: timestamp,
        completedAt: input.completedAt ?? null,
        lastError: input.lastError ?? null,
        resumeCount: input.resumeCount ?? 0,
      });

      const row = (
        await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create agent run");
      }

      return row;
    },
    async getById(id) {
      return (
        (
          await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1)
        )[0] ?? null
      );
    },
    async getActiveByConversation(conversationId) {
      return (
        (
          await db
            .select()
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.conversationId, conversationId),
                inArray(agentRuns.status, ACTIVE_RUN_STATUSES),
              ),
            )
            .orderBy(desc(agentRuns.updatedAt))
            .limit(1)
        )[0] ?? null
      );
    },
    async list() {
      return db.select().from(agentRuns).orderBy(desc(agentRuns.updatedAt));
    },
    async update(id, input) {
      const current = (
        await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1)
      )[0];

      if (!current) {
        return;
      }

      await db
        .update(agentRuns)
        .set({
          status: input.status ?? current.status,
          providerId: input.providerId ?? current.providerId,
          modelId: input.modelId ?? current.modelId,
          input: input.input ?? current.input,
          fileContextSource:
            input.fileContextSource !== undefined
              ? input.fileContextSource
              : current.fileContextSource,
          selectedFileIds: input.selectedFileIds ?? current.selectedFileIds,
          externalFolderSession:
            input.externalFolderSession !== undefined
              ? input.externalFolderSession
              : current.externalFolderSession,
          startedAt: input.startedAt ?? current.startedAt,
          updatedAt: input.updatedAt ?? nowIso(),
          completedAt:
            input.completedAt !== undefined
              ? input.completedAt
              : current.completedAt,
          lastError:
            input.lastError !== undefined ? input.lastError : current.lastError,
          resumeCount: input.resumeCount ?? current.resumeCount,
        })
        .where(eq(agentRuns.id, id));
    },
  };
}
