package expo.modules.deviceautomation

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager

/**
 * Foreground service that owns the [MediaProjection] session and exposes a
 * screen capture API ([captureFrame]) to the module. A foreground service is
 * required on Android 14+ to keep a projection alive, and it surfaces the
 * "app is capturing your screen" indicator to the user.
 *
 * The projection is created here (not in the module) so the service satisfies
 * the MediaProjection/FGS pairing requirement on every API level.
 */
class ScreenCaptureService : Service() {

  companion object {
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    private const val CHANNEL_ID = "screen_capture"
    private const val NOTIFICATION_ID = 2001
    private const val MAX_FRAME_WAIT_MS = 2000L

    @Volatile private var projection: MediaProjection? = null
    @Volatile private var virtualDisplay: VirtualDisplay? = null
    @Volatile private var imageReader: ImageReader? = null

    @Synchronized
    fun isActive(): Boolean = projection != null && imageReader != null

    /** Grab the latest frame as a bitmap, or null if no frame is available yet. */
    @Synchronized
    fun captureFrame(): Bitmap? {
      val reader = imageReader ?: return null
      var image: Image? = null
      var waited = 0L
      while (waited < MAX_FRAME_WAIT_MS) {
        image = reader.acquireNextImage()
        if (image != null) break
        try {
          Thread.sleep(50)
        } catch (_: InterruptedException) {
          return null
        }
        waited += 50
      }
      val frame = image ?: return null
      try {
        val plane = frame.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * frame.width
        val bitmap = Bitmap.createBitmap(
          frame.width + rowPadding / pixelStride,
          frame.height,
          Bitmap.Config.ARGB_8888,
        )
        buffer.rewind()
        bitmap.copyPixelsFromBuffer(buffer)
        return if (rowPadding == 0) {
          bitmap
        } else {
          Bitmap.createBitmap(bitmap, 0, 0, frame.width, frame.height)
        }
      } finally {
        frame.close()
      }
    }

    @Synchronized
    fun stop(): Boolean {
      val hadActive =
        projection != null || virtualDisplay != null || imageReader != null
      try {
        imageReader?.close()
      } catch (_: Exception) {
      }
      try {
        virtualDisplay?.release()
      } catch (_: Exception) {
      }
      try {
        projection?.stop()
      } catch (_: Exception) {
      }
      imageReader = null
      virtualDisplay = null
      projection = null
      return hadActive
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent != null) {
      val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
      val resultData = if (Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(EXTRA_RESULT_DATA)
      }
      if (resultCode != Activity.RESULT_CANCELED && resultData != null) {
        startForegroundCompat()
        startCapture(resultCode, resultData)
      } else {
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  private fun startForegroundCompat() {
    createNotificationChannel()
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Mobile Agent")
      .setContentText("Capturing the screen for automation")
      .setSmallIcon(android.R.drawable.ic_menu_camera)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Screen capture",
        NotificationManager.IMPORTANCE_LOW,
      )
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun startCapture(resultCode: Int, resultData: Intent) {
    stop()
    val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val proj = mpm.getMediaProjection(resultCode, resultData) ?: run {
      stopSelf()
      return
    }
    proj.registerCallback(
      object : MediaProjection.Callback() {
        override fun onStop() {
          stop()
          stopSelf()
        }
      },
      null,
    )

    val metrics = screenSize()
    var width = metrics.widthPixels
    var height = metrics.heightPixels
    if (width % 2 != 0) width -= 1
    if (height % 2 != 0) height -= 1

    val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    val display = proj.createVirtualDisplay(
      "mobile-agent-capture",
      width,
      height,
      metrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      null,
    )
    projection = proj
    imageReader = reader
    virtualDisplay = display
  }

  private fun screenSize(): DisplayMetrics {
    val metrics = DisplayMetrics()
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    @Suppress("DEPRECATION")
    wm.defaultDisplay.getRealMetrics(metrics)
    return metrics
  }

  override fun onDestroy() {
    stop()
    super.onDestroy()
  }
}
