package expo.modules.persistentmodeldownload

import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class PersistentModelDownloadModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PersistentModelDownload")

    AsyncFunction("prepareNotifications") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ModelDownloadWorker.ensureNotificationChannel(context)
    }

    AsyncFunction("startDownload") {
        modelId: String,
        url: String,
        sha256: String,
        expectedBytesValue: Double,
        label: String ->
      start(
        context = appContext.reactContext ?: throw Exceptions.ReactContextLost(),
        modelId = modelId,
        url = url,
        sha256 = sha256,
        expectedBytes = expectedBytesValue.toLong(),
        label = label,
        relativePath = ModelDownloadWorker.defaultTargetPath(modelId),
      )
    }

    /**
     * Starts a persistent download into any file below the app's files
     * directory. Used by the on-device model screen (`.litertlm` files) and by
     * Settings > Voice input (`mobile-agent/voice/ggml-*.bin`).
     */
    AsyncFunction("startFileDownload") {
        modelId: String,
        url: String,
        sha256: String,
        expectedBytesValue: Double,
        label: String,
        relativePath: String ->
      start(
        context = appContext.reactContext ?: throw Exceptions.ReactContextLost(),
        modelId = modelId,
        url = url,
        sha256 = sha256,
        expectedBytes = expectedBytesValue.toLong(),
        label = label,
        relativePath = relativePath,
      )
    }

    AsyncFunction("getDownloadStatus") { modelId: String, expectedBytesValue: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      downloadStatus(
        context,
        modelId,
        expectedBytesValue.toLong(),
        ModelDownloadWorker.defaultTargetPath(modelId),
      )
    }

    AsyncFunction("getFileDownloadStatus") {
        modelId: String,
        expectedBytesValue: Double,
        relativePath: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      downloadStatus(context, modelId, expectedBytesValue.toLong(), relativePath)
    }

    /**
     * Reads the exact WorkManager request created by a previous `start*` call.
     * Polling by id avoids reporting a finished request from an earlier attempt
     * (for example a cancelled download) while a new one is being enqueued.
     */
    AsyncFunction("getFileDownloadStatusById") {
        workId: String,
        expectedBytesValue: Double,
        relativePath: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val info: WorkInfo? = WorkManager.getInstance(context)
        .getWorkInfoById(UUID.fromString(workId))
        .get()
      statusFor(context, info, expectedBytesValue.toLong(), relativePath)
    }

    AsyncFunction("cancelDownload") { modelId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      WorkManager.getInstance(context)
        .cancelUniqueWork(ModelDownloadWorker.uniqueWorkName(modelId))
      // WorkManager normally removes its foreground notification when the work
      // stops, but cancel eagerly so a stale progress notification can never
      // outlive the download it describes.
      NotificationManagerCompat.from(context)
        .cancel(ModelDownloadWorker.notificationId(modelId))
      Unit
    }
  }

  private fun start(
    context: android.content.Context,
    modelId: String,
    url: String,
    sha256: String,
    expectedBytes: Long,
    label: String,
    relativePath: String,
  ): Map<String, Any?> {
    val targetFile = ModelDownloadWorker.targetFile(context, relativePath)

    ModelDownloadWorker.ensureNotificationChannel(context)
    if (targetFile.exists()) {
      return statusMap(
        state = "succeeded",
        bytesDownloaded = targetFile.length(),
        totalBytes = expectedBytes,
      )
    }

    val workManager = WorkManager.getInstance(context)
    val uniqueName = ModelDownloadWorker.uniqueWorkName(modelId)
    val currentWork = workManager.getWorkInfosForUniqueWork(uniqueName).get()
      .firstOrNull { !it.state.isFinished }

    if (currentWork == null) {
      val request = OneTimeWorkRequestBuilder<ModelDownloadWorker>()
        .setConstraints(
          Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build(),
        )
        .setInputData(
          workDataOf(
            ModelDownloadWorker.KEY_MODEL_ID to modelId,
            ModelDownloadWorker.KEY_URL to url,
            ModelDownloadWorker.KEY_SHA256 to sha256,
            ModelDownloadWorker.KEY_EXPECTED_BYTES to expectedBytes,
            ModelDownloadWorker.KEY_LABEL to label,
            ModelDownloadWorker.KEY_RELATIVE_PATH to relativePath,
          ),
        )
        .addTag(ModelDownloadWorker.TAG_MODEL_DOWNLOAD)
        .build()

      workManager.enqueueUniqueWork(uniqueName, ExistingWorkPolicy.REPLACE, request)
        .result
        .get()

      // WorkManager may not expose the new request to a status query for a
      // moment; report "queued" immediately instead of a misleading "idle"
      // that makes the UI drop back to its Download button.
      return statusMap(
        "queued",
        ModelDownloadWorker.partialFile(context, relativePath).length(),
        expectedBytes,
        workId = request.id.toString(),
      )
    }

    return downloadStatus(context, modelId, expectedBytes, relativePath)
  }

  private fun downloadStatus(
    context: android.content.Context,
    modelId: String,
    expectedBytes: Long,
    relativePath: String,
  ): Map<String, Any?> {
    val workInfos = WorkManager.getInstance(context)
      .getWorkInfosForUniqueWork(ModelDownloadWorker.uniqueWorkName(modelId))
      .get()
    val workInfo = workInfos.firstOrNull { !it.state.isFinished }
      // Only surface a finished failure. A previously succeeded run must not
      // masquerade as the current state after the file was deleted and the
      // model was queued again.
      ?: workInfos.lastOrNull {
        it.state == WorkInfo.State.FAILED || it.state == WorkInfo.State.CANCELLED
      }

    return statusFor(context, workInfo, expectedBytes, relativePath)
  }

  private fun statusFor(
    context: android.content.Context,
    workInfo: WorkInfo?,
    expectedBytes: Long,
    relativePath: String,
  ): Map<String, Any?> {
    val target = ModelDownloadWorker.targetFile(context, relativePath)
    if (target.exists()) {
      return statusMap(
        "succeeded",
        target.length(),
        expectedBytes,
        workId = workInfo?.id?.toString(),
      )
    }

    val partial = ModelDownloadWorker.partialFile(context, relativePath)
    val progressData = workInfo?.progress
    val outputData = workInfo?.outputData
    val bytesDownloaded =
      progressData?.getLong(ModelDownloadWorker.KEY_BYTES_DOWNLOADED, partial.length())
        ?: partial.length()
    val totalBytes =
      progressData?.getLong(ModelDownloadWorker.KEY_TOTAL_BYTES, expectedBytes)
        ?: expectedBytes
    val state = when (workInfo?.state) {
      WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
      WorkInfo.State.RUNNING -> "downloading"
      WorkInfo.State.SUCCEEDED -> "succeeded"
      WorkInfo.State.FAILED -> "failed"
      WorkInfo.State.CANCELLED -> "cancelled"
      null -> "idle"
    }

    return statusMap(
      state,
      bytesDownloaded,
      totalBytes,
      outputData?.getString(ModelDownloadWorker.KEY_ERROR),
      workId = workInfo?.id?.toString(),
    )
  }

  private fun statusMap(
    state: String,
    bytesDownloaded: Long,
    totalBytes: Long,
    error: String? = null,
    workId: String? = null,
  ): Map<String, Any?> = mapOf(
    "state" to state,
    "progress" to if (totalBytes > 0) {
      (bytesDownloaded.toDouble() / totalBytes).coerceIn(0.0, 1.0)
    } else {
      0.0
    },
    "bytesDownloaded" to bytesDownloaded.toDouble(),
    "totalBytes" to totalBytes.toDouble(),
    "error" to error,
    "workId" to workId,
  )
}
