package expo.modules.persistentmodeldownload

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
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val expectedBytes = expectedBytesValue.toLong()
      val targetFile = ModelDownloadWorker.targetFile(context, modelId)

      ModelDownloadWorker.ensureNotificationChannel(context)
      if (targetFile.exists()) {
        return@AsyncFunction statusMap(
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
            ),
          )
          .addTag(ModelDownloadWorker.TAG_MODEL_DOWNLOAD)
          .build()

        workManager.enqueueUniqueWork(uniqueName, ExistingWorkPolicy.REPLACE, request)
      }

      downloadStatus(context, modelId, expectedBytes)
    }

    AsyncFunction("getDownloadStatus") { modelId: String, expectedBytesValue: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      downloadStatus(context, modelId, expectedBytesValue.toLong())
    }

    AsyncFunction("cancelDownload") { modelId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      WorkManager.getInstance(context)
        .cancelUniqueWork(ModelDownloadWorker.uniqueWorkName(modelId))
      Unit
    }
  }

  private fun downloadStatus(
    context: android.content.Context,
    modelId: String,
    expectedBytes: Long,
  ): Map<String, Any?> {
    val target = ModelDownloadWorker.targetFile(context, modelId)
    if (target.exists()) {
      return statusMap("succeeded", target.length(), expectedBytes)
    }

    val partial = ModelDownloadWorker.partialFile(context, modelId)
    val workInfo = WorkManager.getInstance(context)
      .getWorkInfosForUniqueWork(ModelDownloadWorker.uniqueWorkName(modelId))
      .get()
      .firstOrNull { !it.state.isFinished }
      ?: WorkManager.getInstance(context)
        .getWorkInfosForUniqueWork(ModelDownloadWorker.uniqueWorkName(modelId))
        .get()
        .firstOrNull()

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
    )
  }

  private fun statusMap(
    state: String,
    bytesDownloaded: Long,
    totalBytes: Long,
    error: String? = null,
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
  )
}
