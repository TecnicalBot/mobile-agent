package expo.modules.scheduleralarm

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Wakes the app process and runs the `SchedulerWakeTask` headless JS task so
 * the scheduler can dispatch due runs and re-arm alarms. When the app is
 * already running the JS engine handles the tick, so this is a no-op.
 */
class SchedulerWakeService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val scheduleId = intent?.getStringExtra(SchedulerAlarmManager.EXTRA_SCHEDULE_ID)
      ?: "tick"

    Handler(mainLooper).post {
      startHeadlessWake(scheduleId)
      stopSelf(startId)
    }

    return START_NOT_STICKY
  }

  private fun startHeadlessWake(scheduleId: String) {
    try {
      val appContext = applicationContext
      if (appContext !is ReactApplication) return

      val reactHost = appContext.reactHost ?: return
      val runningContext = reactHost.currentReactContext

      if (runningContext != null && runningContext.hasActiveReactInstance()) {
        // The JS scheduler engine is already ticking. Running the headless task
        // here would race the engine and dispatch duplicate runs.
        Log.d(TAG, "App already running; skipping headless wake")
        return
      }

      reactHost.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            reactHost.removeReactInstanceEventListener(this)
            runHeadlessTask(context, scheduleId)
          }
        },
      )
      reactHost.start()
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start headless wake", e)
    }
  }

  private fun runHeadlessTask(reactContext: ReactContext, scheduleId: String) {
    try {
      val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
      val taskData = Arguments.createMap()
      taskData.putString(SchedulerAlarmManager.EXTRA_SCHEDULE_ID, scheduleId)
      val taskConfig = HeadlessJsTaskConfig(
        taskKey = "SchedulerWakeTask",
        data = taskData,
        // No timeout: the headless run must be allowed to finish. The task
        // keeps the process alive until the JS side calls finishHeadlessTask.
        timeout = 0L,
      )
      taskContext.startTask(taskConfig)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to run headless task", e)
    }
  }

  private companion object {
    const val TAG = "SchedulerWakeService"
  }
}
