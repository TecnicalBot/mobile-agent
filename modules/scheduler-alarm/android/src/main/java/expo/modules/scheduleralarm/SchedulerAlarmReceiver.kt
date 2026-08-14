package expo.modules.scheduleralarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Fired by AlarmManager when a scheduled task comes due. Delegates to
 * [SchedulerWakeService], which boots the headless JS scheduler when the app
 * process was killed (when the process is alive the JS engine handles the
 * tick itself and the wake service is a no-op).
 */
class SchedulerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val scheduleId = intent.getStringExtra(SchedulerAlarmManager.EXTRA_SCHEDULE_ID)
      ?: "tick"

    try {
      val serviceIntent = Intent(context, SchedulerWakeService::class.java).apply {
        putExtra(SchedulerAlarmManager.EXTRA_SCHEDULE_ID, scheduleId)
      }
      context.startService(serviceIntent)
    } catch (e: Exception) {
      Log.e("SchedulerAlarm", "Failed to start wake service", e)
    }
  }
}
