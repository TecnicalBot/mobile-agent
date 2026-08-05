package expo.modules.deviceautomation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import java.util.concurrent.CompletableFuture

data class InstallStatus(
  val status: Int,
  val legacyStatus: Int,
  val message: String?,
  val packageName: String?,
)

/**
 * Receives [PackageInstaller] status broadcasts from [android.content.pm.PackageInstaller.Session.commit].
 * Completes the future registered for the matching session once a terminal status arrives;
 * intermediate [PackageInstaller.STATUS_PENDING_USER_ACTION] broadcasts are ignored so the
 * caller keeps waiting while the user confirms the install.
 */
class InstallStatusReceiver : BroadcastReceiver() {

  companion object {
    private const val TAG = "InstallStatusReceiver"

    private val listeners = HashMap<Int, CompletableFuture<InstallStatus>>()

    @Synchronized
    fun register(sessionId: Int, future: CompletableFuture<InstallStatus>) {
      listeners[sessionId] = future
    }

    @Synchronized
    fun unregister(sessionId: Int) {
      listeners.remove(sessionId)
    }

    @Synchronized
    fun route(sessionId: Int, status: InstallStatus) {
      if (status.status == PackageInstaller.STATUS_PENDING_USER_ACTION) return
      val future = listeners.remove(sessionId)
        ?: (if (listeners.size == 1) listeners.remove(listeners.keys.first()) else null)
        ?: return
      future.complete(status)
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val legacyStatus = intent.getIntExtra("android.content.pm.extra.LEGACY_STATUS", 0)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
    val packageName = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME)
    val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
    Log.i(
      TAG,
      "install status session=$sessionId status=$status legacy=$legacyStatus package=$packageName message=$message",
    )
    route(sessionId, InstallStatus(status, legacyStatus, message, packageName))
  }
}
