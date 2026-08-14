import * as Crypto from "expo-crypto";
import { and, desc, eq } from "drizzle-orm";

import { scheduleRuns } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ScheduleRunRepository,
} from "@/core/db/repositories/types";

export function createScheduleRunRepository(
  db: AppDatabase,
): ScheduleRunRepository {
  return {
    async create(input) {
      const id = input.id ?? Crypto.randomUUID();

      await db.insert(scheduleRuns).values({
        id,
        scheduleId: input.scheduleId,
        runId: input.runId ?? null,
        status: input.status,
        error: input.error ?? null,
        startedAt: input.startedAt ?? nowIso(),
        completedAt: input.completedAt ?? null,
      });

      const row = await this.getById(id);

      if (!row) {
        throw new Error("Failed to create schedule run");
      }

      return row;
    },
    async getById(id) {
      return (
        await db
          .select()
          .from(scheduleRuns)
          .where(eq(scheduleRuns.id, id))
          .limit(1)
      )[0] ?? null;
    },
    async listBySchedule(scheduleId, limit) {
      const query = db
        .select()
        .from(scheduleRuns)
        .where(eq(scheduleRuns.scheduleId, scheduleId))
        .orderBy(desc(scheduleRuns.startedAt));

      if (limit) {
        query.limit(limit);
      }

      return query;
    },
    async update(id, input) {
      const current = await this.getById(id);

      if (!current) {
        return;
      }

      await db
        .update(scheduleRuns)
        .set({
          runId: input.runId ?? current.runId,
          status: input.status ?? current.status,
          error: input.error ?? current.error,
          completedAt: input.completedAt ?? current.completedAt,
        })
        .where(eq(scheduleRuns.id, id));
    },
  };
}
