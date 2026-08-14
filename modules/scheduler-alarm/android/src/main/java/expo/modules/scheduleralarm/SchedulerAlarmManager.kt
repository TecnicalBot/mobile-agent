package expo.modules.scheduleralarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log

object SchedulerAlarmManager {
  private const val TAG = "SchedulerAlarm"
  private const val PREFS_NAME = "scheduler-alarms"
  private const val KEY_IDS = "schedule-ids"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun requestCodeFor(scheduleId: String): Int =
    (0x11000000) or (scheduleId.hashCode() and 0x00ffffff)

  fun buildAlarmIntent(context: Context, scheduleId: String): Intent =
    Intent(context, SchedulerAlarmReceiver::class.java).apply {
      action = ACTION_ALARM
      putExtra(EXTRA_SCHEDULE_ID, scheduleId)
    }

  fun canScheduleExact(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.canScheduleExactAlarms()
    } else {
      true
    }

  fun openExactAlarmSettings(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    try {
      val intent = Intent(
        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.w(TAG, "Failed to open exact alarm settings", e)
    }
  }

  fun setAlarm(context: Context, triggerAtMs: Long, scheduleId: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = buildPendingIntent(context, scheduleId)

    try {
      if (canScheduleExact(context)) {
        alarmManager.setExactAndAllowWhileIdle(
          AlarmManager.RTC_WAKEUP,
          triggerAtMs,
          pendingIntent,
        )
      } else {
        alarmManager.setAndAllowWhileIdle(
          AlarmManager.RTC_WAKEUP,
          triggerAtMs,
          pendingIntent,
        )
      }
    } catch (e: SecurityException) {
      Log.w(TAG, "Exact alarm denied; falling back to inexact", e)
      alarmManager.setAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        triggerAtMs,
        pendingIntent,
      )
    }

    rememberScheduleId(context, scheduleId)
  }

  fun cancelAlarm(context: Context, scheduleId: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmManager.cancel(buildPendingIntent(context, scheduleId))
    forgetScheduleId(context, scheduleId)
  }

  fun cancelAll(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val ids = prefs(context).getStringSet(KEY_IDS, emptySet()) ?: emptySet()

    for (scheduleId in ids) {
      alarmManager.cancel(buildPendingIntent(context, scheduleId))
    }

    prefs(context).edit().putStringSet(KEY_IDS, emptySet()).apply()
  }

  private fun buildPendingIntent(context: Context, scheduleId: String): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      requestCodeFor(scheduleId),
      buildAlarmIntent(context, scheduleId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun rememberScheduleId(context: Context, scheduleId: String) {
    val ids = (prefs(context).getStringSet(KEY_IDS, emptySet()) ?: emptySet())
      .toMutableSet()
    ids.add(scheduleId)
    prefs(context).edit().putStringSet(KEY_IDS, ids).apply()
  }

  private fun forgetScheduleId(context: Context, scheduleId: String) {
    val ids = (prefs(context).getStringSet(KEY_IDS, emptySet()) ?: emptySet())
      .toMutableSet()
    ids.remove(scheduleId)
    prefs(context).edit().putStringSet(KEY_IDS, ids).apply()
  }

  const val ACTION_ALARM = "expo.modules.scheduleralarm.ALARM"
  const val EXTRA_SCHEDULE_ID = "scheduleId"
}
