package expo.modules.backgroundagentservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.net.wifi.WifiManager
import androidx.core.app.NotificationCompat

class BackgroundAgentService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        acquireWakeLocks()
        startForegroundNotification()
        isActive = true
      }
      ACTION_STOP -> {
        isActive = false
        releaseWakeLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isActive = false
    releaseWakeLocks()
    super.onDestroy()
  }

  private fun acquireWakeLocks() {
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(
        PowerManager.PARTIAL_WAKE_LOCK,
        WAKE_LOCK_TAG,
      ).also { it.acquire() }
    }

    if (wifiLock == null) {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      wifiLock = wm.createWifiLock(
        WifiManager.WIFI_MODE_FULL_HIGH_PERF,
        WIFI_LOCK_TAG,
      ).also { it.acquire() }
    }
  }

  private fun releaseWakeLocks() {
    wakeLock?.let {
      if (it.isHeld) it.release()
    }
    wakeLock = null

    wifiLock?.let {
      if (it.isHeld) it.release()
    }
    wifiLock = null
  }

  private fun startForegroundNotification() {
    val notification = createNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createNotification(): Notification {
    val stopIntent = Intent(this, BackgroundAgentService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPendingIntent = PendingIntent.getService(
      this,
      0,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        1,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Agent is running")
      .setContentText("Running in background")
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .addAction(
        android.R.drawable.ic_media_pause,
        "Stop",
        stopPendingIntent,
      )
      .build()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Background agent",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Keeps the agent alive when running in background"
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    var isActive = false
      private set

    const val ACTION_START = "expo.modules.backgroundagentservice.START"
    const val ACTION_STOP = "expo.modules.backgroundagentservice.STOP"
    private const val CHANNEL_ID = "agent-run"
    private const val NOTIFICATION_ID = 31001
    private const val WAKE_LOCK_TAG = "background-agent:wakelock"
    private const val WIFI_LOCK_TAG = "background-agent:wifilock"
  }
}
