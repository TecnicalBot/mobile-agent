package expo.modules.persistentmodeldownload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

class ModelDownloadWorker(
  appContext: Context,
  workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result {
    val modelId = inputData.getString(KEY_MODEL_ID) ?: return failure("Missing model ID")
    val url = inputData.getString(KEY_URL) ?: return failure("Missing download URL")
    val sha256 = inputData.getString(KEY_SHA256) ?: return failure("Missing SHA256")
    val expectedBytes = inputData.getLong(KEY_EXPECTED_BYTES, 0L)
    val label = inputData.getString(KEY_LABEL) ?: modelId

    ensureNotificationChannel(applicationContext)
    setForeground(createForegroundInfo(label, 0L, expectedBytes))

    return withContext(Dispatchers.IO) {
      try {
        val target = targetFile(applicationContext, modelId)
        val partial = partialFile(applicationContext, modelId)
        target.parentFile?.mkdirs()

        if (target.exists()) {
          return@withContext success(target.length(), expectedBytes)
        }

        if (expectedBytes > 0 && partial.length() > expectedBytes) {
          partial.delete()
        }

        if (
          partial.exists() &&
          expectedBytes > 0 &&
          partial.length() == expectedBytes &&
          verifySha256(partial, sha256)
        ) {
          moveCompletedFile(partial, target)
          return@withContext success(target.length(), expectedBytes)
        }

        var bytesDownloaded = partial.takeIf { it.exists() }?.length() ?: 0L
        reportProgress(label, bytesDownloaded, expectedBytes, force = true)

        val connection = openConnectionFollowingRedirects(url, bytesDownloaded)
        val append = bytesDownloaded > 0 && connection.responseCode == HttpURLConnection.HTTP_PARTIAL
        if (!append) {
          bytesDownloaded = 0L
        }

        connection.inputStream.use { input ->
          FileOutputStream(partial, append).use { output ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var lastReportedAt = 0L
            var lastReportedBytes = bytesDownloaded

            while (true) {
              coroutineContext.ensureActive()
              val read = input.read(buffer)
              if (read == -1) break

              output.write(buffer, 0, read)
              bytesDownloaded += read

              val now = System.currentTimeMillis()
              val enoughTimePassed = now - lastReportedAt >= PROGRESS_INTERVAL_MS
              val enoughBytesPassed =
                bytesDownloaded - lastReportedBytes >= PROGRESS_INTERVAL_BYTES
              if (enoughTimePassed || enoughBytesPassed) {
                reportProgress(label, bytesDownloaded, expectedBytes)
                lastReportedAt = now
                lastReportedBytes = bytesDownloaded
              }
            }
            output.fd.sync()
          }
        }
        connection.disconnect()

        reportProgress(label, bytesDownloaded, expectedBytes, force = true)

        if (expectedBytes > 0 && bytesDownloaded != expectedBytes) {
          throw IOException(
            "Downloaded $bytesDownloaded bytes, expected $expectedBytes bytes",
          )
        }
        if (!verifySha256(partial, sha256)) {
          partial.delete()
          return@withContext failure("Downloaded model failed its integrity check")
        }

        moveCompletedFile(partial, target)
        success(target.length(), expectedBytes)
      } catch (error: CancellationException) {
        throw error
      } catch (error: IOException) {
        if (runAttemptCount < MAX_RETRY_COUNT) {
          Result.retry()
        } else {
          failure(error.message ?: "Network download failed")
        }
      } catch (error: Exception) {
        failure(error.message ?: "Model download failed")
      }
    }
  }

  private suspend fun reportProgress(
    label: String,
    bytesDownloaded: Long,
    totalBytes: Long,
    force: Boolean = false,
  ) {
    val data = workDataOf(
      KEY_BYTES_DOWNLOADED to bytesDownloaded,
      KEY_TOTAL_BYTES to totalBytes,
    )
    setProgress(data)
    setForeground(createForegroundInfo(label, bytesDownloaded, totalBytes))

    if (force) {
      val manager =
        applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(notificationId(id.toString()), createNotification(label, bytesDownloaded, totalBytes))
    }
  }

  private fun createForegroundInfo(
    label: String,
    bytesDownloaded: Long,
    totalBytes: Long,
  ): ForegroundInfo {
    val notification = createNotification(label, bytesDownloaded, totalBytes)
    val notificationId = notificationId(id.toString())

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(
        notificationId,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      ForegroundInfo(notificationId, notification)
    }
  }

  private fun createNotification(
    label: String,
    bytesDownloaded: Long,
    totalBytes: Long,
  ): android.app.Notification {
    val progress = if (totalBytes > 0) {
      ((bytesDownloaded * 100L) / totalBytes).toInt().coerceIn(0, 100)
    } else {
      0
    }
    val cancelIntent = WorkManager.getInstance(applicationContext)
      .createCancelPendingIntent(id)
    val launchIntent = applicationContext.packageManager
      .getLaunchIntentForPackage(applicationContext.packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        applicationContext,
        notificationId(id.toString()),
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    return NotificationCompat.Builder(applicationContext, CHANNEL_ID)
      .setSmallIcon(applicationContext.applicationInfo.icon)
      .setContentTitle("Downloading $label")
      .setContentText(
        if (totalBytes > 0) {
          "${formatBytes(bytesDownloaded)} of ${formatBytes(totalBytes)}"
        } else {
          formatBytes(bytesDownloaded)
        },
      )
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setSilent(true)
      .setProgress(100, progress, totalBytes <= 0)
      .addAction(
        android.R.drawable.ic_menu_close_clear_cancel,
        "Cancel",
        cancelIntent,
      )
      .build()
  }

  private fun success(bytesDownloaded: Long, totalBytes: Long): Result =
    Result.success(
      workDataOf(
        KEY_BYTES_DOWNLOADED to bytesDownloaded,
        KEY_TOTAL_BYTES to totalBytes,
      ),
    )

  private fun failure(message: String): Result =
    Result.failure(workDataOf(KEY_ERROR to message))

  private fun openConnectionFollowingRedirects(
    initialUrl: String,
    resumeAt: Long,
  ): HttpURLConnection {
    var currentUrl = initialUrl
    repeat(MAX_REDIRECTS + 1) {
      val connection = URL(currentUrl).openConnection() as HttpURLConnection
      connection.connectTimeout = CONNECTION_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("Accept-Encoding", "identity")
      if (resumeAt > 0) {
        connection.setRequestProperty("Range", "bytes=$resumeAt-")
      }
      connection.connect()

      when (connection.responseCode) {
        HttpURLConnection.HTTP_OK,
        HttpURLConnection.HTTP_PARTIAL -> return connection

        HttpURLConnection.HTTP_MOVED_PERM,
        HttpURLConnection.HTTP_MOVED_TEMP,
        HttpURLConnection.HTTP_SEE_OTHER,
        307,
        308 -> {
          val location = connection.getHeaderField("Location")
            ?: throw IOException("Redirect response had no Location header")
          connection.disconnect()
          currentUrl = URL(URL(currentUrl), location).toString()
        }

        else -> {
          val code = connection.responseCode
          val message = connection.responseMessage
          connection.disconnect()
          throw IOException("HTTP $code: $message")
        }
      }
    }
    throw IOException("Too many redirects")
  }

  private fun verifySha256(file: File, expected: String): Boolean {
    if (expected.isBlank()) return true

    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        digest.update(buffer, 0, read)
      }
    }
    val actual = digest.digest().joinToString("") { "%02x".format(it) }
    return actual.equals(expected, ignoreCase = true)
  }

  private fun moveCompletedFile(partial: File, target: File) {
    try {
      Files.move(
        partial.toPath(),
        target.toPath(),
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING,
      )
    } catch (_: Exception) {
      Files.move(
        partial.toPath(),
        target.toPath(),
        StandardCopyOption.REPLACE_EXISTING,
      )
    }
  }

  private fun formatBytes(bytes: Long): String {
    val gibibytes = bytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
    return if (gibibytes >= 1.0) {
      String.format("%.1f GB", gibibytes)
    } else {
      String.format("%.0f MB", bytes.toDouble() / (1024.0 * 1024.0))
    }
  }

  companion object {
    const val KEY_MODEL_ID = "modelId"
    const val KEY_URL = "url"
    const val KEY_SHA256 = "sha256"
    const val KEY_EXPECTED_BYTES = "expectedBytes"
    const val KEY_LABEL = "label"
    const val KEY_BYTES_DOWNLOADED = "bytesDownloaded"
    const val KEY_TOTAL_BYTES = "totalBytes"
    const val KEY_ERROR = "error"
    const val TAG_MODEL_DOWNLOAD = "persistent-model-download"

    private const val CHANNEL_ID = "model-downloads"
    private const val MAX_REDIRECTS = 8
    private const val MAX_RETRY_COUNT = 5
    private const val CONNECTION_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val PROGRESS_INTERVAL_MS = 500L
    private const val PROGRESS_INTERVAL_BYTES = 1_048_576L
    private const val NOTIFICATION_ID_BASE = 24_000

    fun uniqueWorkName(modelId: String) = "model-download-$modelId"

    fun targetFile(context: Context, modelId: String) =
      File(context.filesDir, "models/$modelId.litertlm")

    fun partialFile(context: Context, modelId: String) =
      File(context.filesDir, "models/$modelId.litertlm.tmp")

    fun notificationId(value: String) =
      NOTIFICATION_ID_BASE + (value.hashCode() and 0x0FFF)

    fun ensureNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

      val manager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Model downloads",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Progress for offline AI model downloads"
        setSound(null, null)
        enableVibration(false)
      }
      manager.createNotificationChannel(channel)
    }
  }
}
