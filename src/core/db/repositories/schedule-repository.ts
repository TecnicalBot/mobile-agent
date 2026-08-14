import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { schedules } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ScheduleRepository,
} from "@/core/db/repositories/types";

export function createScheduleRepository(db: AppDatabase): ScheduleRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(schedules).values({
        id,
        title: input.title,
        prompt: input.prompt,
        expression: input.expression,
        timezone: input.timezone,
        providerId: input.providerId,
        modelId: input.modelId,
        autoApprove: input.autoApprove ?? true,
        enabled: input.enabled ?? true,
        conversationId: input.conversationId ?? null,
        externalFolderSession: input.externalFolderSession ?? null,
        lastRunAt: input.lastRunAt ?? null,
        nextRunAt: input.nextRunAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create schedule");
      }

      return row;
    },
    async delete(id) {
      await db.delete(schedules).where(eq(schedules.id, id));
    },
    async getById(id) {
      return (
        await db
          .select()
          .from(schedules)
          .where(eq(schedules.id, id))
          .limit(1)
      )[0] ?? null;
    },
    async list() {
      return db.select().from(schedules).orderBy(desc(schedules.updatedAt));
    },
    async listEnabled() {
      return db
        .select()
        .from(schedules)
        .where(eq(schedules.enabled, true))
        .orderBy(desc(schedules.updatedAt));
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(schedules)
        .set({
          title: input.title ?? current.title,
          prompt: input.prompt ?? current.prompt,
          expression: input.expression ?? current.expression,
          timezone: input.timezone ?? current.timezone,
          providerId: input.providerId ?? current.providerId,
          modelId: input.modelId ?? current.modelId,
          autoApprove: input.autoApprove ?? current.autoApprove,
          enabled: input.enabled ?? current.enabled,
          conversationId:
            input.conversationId !== undefined
              ? input.conversationId
              : current.conversationId,
          externalFolderSession:
            input.externalFolderSession !== undefined
              ? input.externalFolderSession
              : current.externalFolderSession,
          lastRunAt: input.lastRunAt ?? current.lastRunAt,
          nextRunAt: input.nextRunAt ?? current.nextRunAt,
          updatedAt: nowIso(),
        })
        .where(eq(schedules.id, id));
    },
  };
}
