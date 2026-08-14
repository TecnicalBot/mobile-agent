import { Platform } from "react-native";

import type { Repositories } from "@/core/db/repositories/types";

export const SCHEDULER_ALARM_ACTION =
  "expo.modules.scheduleralarm.SCHEDULER_ALARM";

/**
 * Re-arms the native Android alarms so they match the enabled schedules stored
 * in the database. A no-op on every other platform (iOS uses calendar
 * notifications instead, dispatched from `onSchedulesChanged`).
 */
export async function syncScheduleAlarms(
  repositories: Repositories,
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  const { cancelAllScheduleAlarms, setScheduleAlarm } = await import(
    "scheduler-alarm"
  );

  try {
    await cancelAllScheduleAlarms();

    const settings = await repositories.configRepository.getSettings();

    if (!settings.schedulingEnabled) {
      return;
    }

    const schedules = await repositories.scheduleRepository.listEnabled();
    const now = Date.now();

    for (const schedule of schedules) {
      if (!schedule.nextRunAt) {
        continue;
      }

      const triggerAtMs = new Date(schedule.nextRunAt).getTime();

      if (triggerAtMs > now) {
        await setScheduleAlarm(triggerAtMs, schedule.id);
      }
    }
  } catch (error) {
    console.error("[scheduler] Failed to sync alarms:", error);
  }
}
