package expo.modules.scheduleralarm

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SchedulerAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SchedulerAlarm")

    AsyncFunction("setAlarm") { triggerAtMs: Double, scheduleId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SchedulerAlarmManager.setAlarm(context, triggerAtMs.toLong(), scheduleId)
      Unit
    }

    AsyncFunction("cancelAlarm") { scheduleId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SchedulerAlarmManager.cancelAlarm(context, scheduleId)
      Unit
    }

    AsyncFunction("cancelAllAlarms") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SchedulerAlarmManager.cancelAll(context)
      Unit
    }

    AsyncFunction("hasExactAlarmPermission") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SchedulerAlarmManager.canScheduleExact(context)
    }

    AsyncFunction("openExactAlarmSettings") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SchedulerAlarmManager.openExactAlarmSettings(context)
      Unit
    }
  }
}
