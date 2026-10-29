package expo.modules.backgroundagentservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

class BackgroundAgentService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureNotificationChannels()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        waitingForApproval = false
        phoneBridgeApproval = false
        acquireWakeLocks()
        startForegroundNotification()
        isActive = true
      }
      ACTION_STOP -> {
        isActive = false
        waitingForApproval = false
        phoneBridgeApproval = false
        releaseWakeLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isActive = false
    instance = null
    waitingForApproval = false
    phoneBridgeApproval = false
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
      // connectedDevice is the right type for serving a paired device over the
      // network, and unlike dataSync it has no six-hour daily timeout.
      try {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
        )
        return
      } catch (cause: IllegalArgumentException) {
        // A binary built against an older manifest still declares dataSync.
        // Serving the bridge is better than crashing the whole app.
        Log.w(TAG, "connectedDevice type missing from manifest", cause)
      } catch (cause: SecurityException) {
        Log.w(TAG, "connectedDevice type not permitted", cause)
      }
    }
    // Falls back to the type declared by the manifest (dataSync on old builds).
    startForeground(NOTIFICATION_ID, notification)
  }

  private fun updateNotification() {
    if (!isActive) return

    try {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, createNotification())
    } catch (_: SecurityException) {}
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

    val approvalIntent = Intent(this, BackgroundAgentActionReceiver::class.java)
    fun approvalAction(action: String, requestCode: Int) = PendingIntent.getBroadcast(
      this,
      requestCode,
      Intent(approvalIntent).setAction(action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val contentTitle = when {
      phoneBridgeApproval -> "Phone tool approval"
      waitingForApproval -> "Approval needed"
      else -> "Agent is running"
    }
    val contentText = when {
      phoneBridgeApproval -> "A harness is waiting for permission"
      waitingForApproval -> detail ?: "Open Mobile Agent to respond"
      else -> detail ?: "Running in background"
    }

    val builder = NotificationCompat.Builder(
      this,
      if (waitingForApproval) APPROVAL_CHANNEL_ID else CHANNEL_ID,
    )
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(contentTitle)
      .setContentText(contentText)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(
        if (waitingForApproval) NotificationCompat.PRIORITY_HIGH
        else NotificationCompat.PRIORITY_LOW,
      )
      .setOngoing(true)
      .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)

    // A silent notification cannot surface as a heads-up on Android 13+, so the
    // approval notification stays audible-capable (its channel has no sound).
    if (!phoneBridgeApproval) builder.setSilent(true)

    if (phoneBridgeApproval) {
      builder
        .addAction(
          android.R.drawable.ic_delete,
          "Deny",
          approvalAction(ACTION_DENY, 2),
        )
        .addAction(
          android.R.drawable.ic_menu_save,
          "Allow",
          approvalAction(ACTION_ALLOW, 3),
        )
    }

    return builder.build()
  }

  private fun ensureNotificationChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Background agent",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Keeps the agent alive when running in background"
        setSound(null, null)
        enableVibration(false)
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(
        APPROVAL_CHANNEL_ID,
        "Phone tool approvals",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Asks for permission before a paired harness uses phone tools"
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  companion object {
    var isActive = false
      private set

    @Volatile
    var waitingForApproval = false
      private set

    /** Only the phone bridge shows Allow/Deny on the notification. */
    @Volatile
    var phoneBridgeApproval = false
      private set

    @Volatile
    private var detail: String? = null

    @Volatile
    private var instance: BackgroundAgentService? = null

    fun setWaitingForApproval(waiting: Boolean, bridge: Boolean = false) {
      val nextBridge = waiting && bridge
      if (waitingForApproval == waiting && phoneBridgeApproval == nextBridge) return
      waitingForApproval = waiting
      phoneBridgeApproval = nextBridge
      instance?.updateNotification()
    }

    fun setDetail(value: String?) {
      if (detail == value) return
      detail = value
      instance?.updateNotification()
    }

    const val ACTION_START = "expo.modules.backgroundagentservice.START"
    const val ACTION_STOP = "expo.modules.backgroundagentservice.STOP"
    const val ACTION_ALLOW = "expo.modules.backgroundagentservice.ALLOW"
    const val ACTION_DENY = "expo.modules.backgroundagentservice.DENY"
    private const val CHANNEL_ID = "agent-run"
    private const val APPROVAL_CHANNEL_ID = "agent-approval"
    private const val NOTIFICATION_ID = 31001
    private const val TAG = "BackgroundAgent"
    private const val WAKE_LOCK_TAG = "background-agent:wakelock"
    private const val WIFI_LOCK_TAG = "background-agent:wifilock"
  }
}
