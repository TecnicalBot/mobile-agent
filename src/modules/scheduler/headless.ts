import { openDatabaseSync } from "expo-sqlite";

import { createRepositories, migrateAppDatabase } from "@/core/db/database";
import type { Schedule } from "@/core/types/app-state";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { createRunControllerRegistry } from "@/modules/runtime/run-manager";
import { syncScheduleAlarms } from "./alarm-sync";
import { runSchedulerTick } from "./engine";
import { dispatchScheduledRunHeadless } from "./dispatch";

/**
 * Runs a full scheduler pass from a headless context (triggered by the native
 * alarm receiver when the app process was killed). Opens the app database
 * directly, fires every due schedule, and re-arms the native alarms.
 */
export async function runSchedulerHeadlessTick(): Promise<void> {
  const db = openDatabaseSync("mobile-agent.db");

  try {
    await migrateAppDatabase(db);
    const repositories = createRepositories(db);
    const settings = await repositories.configRepository.getSettings();

    if (!settings.schedulingEnabled) {
      await syncScheduleAlarms(repositories);
      return;
    }

    const dispatchRun = async (schedule: Schedule) => {
      await dispatchScheduledRunHeadless(repositories, schedule);
    };

    await runSchedulerTick(repositories, dispatchRun, (error) => {
      console.error("[scheduler:headless] Tick error:", error);
    });
    await syncScheduleAlarms(repositories);
  } finally {
    db.closeSync();
  }
}
