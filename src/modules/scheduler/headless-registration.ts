import { AppRegistry } from "react-native";

import { runSchedulerHeadlessTick } from "./headless";

export const SCHEDULER_WAKE_TASK_KEY = "SchedulerWakeTask";

AppRegistry.registerHeadlessTask(
  SCHEDULER_WAKE_TASK_KEY,
  () => async (taskData: { scheduleId?: string }) => {
    try {
      await runSchedulerHeadlessTick();
    } catch (error) {
      console.error("[scheduler:headless] Wake task failed:", error);
    }
  },
);
