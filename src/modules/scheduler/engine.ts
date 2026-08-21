import type { Repositories } from "@/core/db/repositories/types";
import type { Schedule as ScheduleRecord } from "@/core/types/app-state";
import { nowIso } from "@/core/db/repositories/shared";

import { computeNextRun } from "./cron";

export const SCHEDULER_TICK_INTERVAL_MS = 30_000;
export const SCHEDULER_GRACE_WINDOW_MS = 60 * 60 * 1000;

export type SchedulerEngineCallbacks = {
  dispatchRun: (schedule: ScheduleRecord) => Promise<void>;
  onError?: (error: unknown) => void;
  /** Called whenever any schedule's next-run time changes (alarm sync hint). */
  onSchedulesChanged?: () => void;
};

export type SchedulerEngine = {
  start: () => void;
  stop: () => void;
  /** Re-run the tick immediately (used after schedule CRUD). */
  refresh: () => void;
};

export async function advanceSchedule(
  repositories: Pick<Repositories, "scheduleRepository" | "scheduleRunRepository">,
  dispatchRun: (schedule: ScheduleRecord) => Promise<void>,
  onError: ((error: unknown) => void) | undefined,
  schedule: ScheduleRecord,
  now: number,
) {
  if (!schedule.nextRunAt) {
    const initial = computeNextRun(schedule.expression, schedule.timezone);

    await repositories.scheduleRepository.update(schedule.id, {
      nextRunAt: initial?.toISOString() ?? null,
    });

    return true;
  }

  const scheduledTime = new Date(schedule.nextRunAt).getTime();

  if (scheduledTime > now) {
    return false;
  }

  const lateBy = now - scheduledTime;
  let fired = false;

  if (lateBy <= SCHEDULER_GRACE_WINDOW_MS) {
    try {
      await dispatchRun(schedule);
      fired = true;
    } catch (error) {
      await repositories.scheduleRunRepository.create({
        scheduleId: schedule.id,
        status: "failed",
        error:
          error instanceof Error ? error.message : "Scheduled run failed to start.",
        startedAt: schedule.nextRunAt,
      });
      onError?.(error);
    }
  } else {
    await repositories.scheduleRunRepository.create({
      scheduleId: schedule.id,
      status: "skipped",
      startedAt: schedule.nextRunAt,
    });
  }

  const next = computeNextRun(
    schedule.expression,
    schedule.timezone,
    new Date(Math.max(scheduledTime, now)),
  );

  await repositories.scheduleRepository.update(schedule.id, {
    lastRunAt: fired ? nowIso() : schedule.nextRunAt,
    nextRunAt: next?.toISOString() ?? null,
  });

  return true;
}

/** Runs one scheduler pass: fires every due schedule, then advances each one. */
export async function runSchedulerTick(
  repositories: Pick<Repositories, "scheduleRepository" | "scheduleRunRepository">,
  dispatchRun: (schedule: ScheduleRecord) => Promise<void>,
  onError?: (error: unknown) => void,
): Promise<void> {
  const schedules = await repositories.scheduleRepository.listEnabled();
  const now = Date.now();

  for (const schedule of schedules) {
    await advanceSchedule(repositories, dispatchRun, onError, schedule, now);
  }
}

export function createSchedulerEngine(
  repositories: Pick<Repositories, "scheduleRepository" | "scheduleRunRepository">,
  callbacks: SchedulerEngineCallbacks,
): SchedulerEngine {
  let running = false;
  let firing = false;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSyncedFingerprint = "";

  function fingerprint(schedules: ScheduleRecord[]) {
    return schedules
      .map((schedule) => `${schedule.id}:${schedule.nextRunAt ?? "none"}`)
      .join("|");
  }

  function armNextTick() {
    if (!running) {
      return;
    }

    if (tickTimer) {
      clearTimeout(tickTimer);
    }

    tickTimer = setTimeout(() => {
      void tick().catch((error) => callbacks.onError?.(error));
    }, SCHEDULER_TICK_INTERVAL_MS);
  }

  async function tick() {
    if (firing) {
      return;
    }

    firing = true;

    try {
      await runSchedulerTick(repositories, callbacks.dispatchRun, callbacks.onError);

      const refreshed = await repositories.scheduleRepository.listEnabled();
      const nextFingerprint = fingerprint(refreshed);

      if (nextFingerprint !== lastSyncedFingerprint) {
        lastSyncedFingerprint = nextFingerprint;
        callbacks.onSchedulesChanged?.();
      }
    } finally {
      firing = false;
      armNextTick();
    }
  }

  function start() {
    if (running) {
      return;
    }

    running = true;
    void tick().catch((error) => callbacks.onError?.(error));
  }

  function stop() {
    running = false;

    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
  }

  function refresh() {
    if (running) {
      void tick().catch((error) => callbacks.onError?.(error));
    }
  }

  return { start, stop, refresh };
}
