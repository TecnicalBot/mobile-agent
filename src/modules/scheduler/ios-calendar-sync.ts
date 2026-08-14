import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { Repositories } from "@/core/db/repositories/types";

export const SCHEDULE_DUE_NOTIFICATION_TYPE = "schedule-due";

const SCHEDULE_NOTIFICATION_ID_PREFIX = "schedule-due:";

/**
 * iOS fallback: iOS has no reliable background execution, so instead of
 * running the task at the scheduled time we schedule a notification for the
 * next run. Tapping it opens the app, where the scheduler engine dispatches
 * the due run. No-op on every other platform (Android uses native alarms).
 */
export async function syncScheduleCalendarNotifications(
  repositories: Repositories,
): Promise<void> {
  if (Platform.OS !== "ios") {
    return;
  }

  try {
    const scheduled =
      await Notifications.getAllScheduledNotificationsAsync();

    for (const notification of scheduled) {
      if (
        notification.content.data?.type === SCHEDULE_DUE_NOTIFICATION_TYPE
      ) {
        await Notifications.cancelScheduledNotificationAsync(
          notification.identifier,
        );
      }
    }

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

      const next = new Date(schedule.nextRunAt).getTime();

      if (next <= now) {
        continue;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          body: schedule.prompt.slice(0, 120),
          data: {
            scheduleId: schedule.id,
            type: SCHEDULE_DUE_NOTIFICATION_TYPE,
          },
          title: `Scheduled job: ${schedule.title}`,
        },
        identifier: `${SCHEDULE_NOTIFICATION_ID_PREFIX}${schedule.id}`,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(next),
        },
      });
    }
  } catch (error) {
    console.error("[scheduler] Failed to sync iOS notifications:", error);
  }
}
