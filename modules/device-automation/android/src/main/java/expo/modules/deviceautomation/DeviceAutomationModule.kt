package expo.modules.deviceautomation

import android.app.Activity
import android.app.PendingIntent
import android.content.ClipData
import android.content.ComponentName
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.graphics.Bitmap
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.content.ContentUris
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * JS-facing surface for device automation. Reads the screen and performs
 * actions through [DeviceAutomationAccessibilityService] (perception + gestures)
 * and drives apps/links through plain intents.
 */
class DeviceAutomationModule : Module() {
  companion object {
    private const val TAG = "DeviceAutomation"
    private const val SCREEN_CAPTURE_REQUEST_CODE = 0x0D4E
    private const val FILE_PICK_REQUEST_CODE = 0x0D4F
    private const val SCREEN_CAPTURE_START_TIMEOUT_MS = 5000L
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  @Volatile
  private var pendingCaptureRequest: CompletableFuture<Boolean>? = null

  @Volatile
  private var pendingFilePick: CompletableFuture<String?>? = null

  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("DeviceAutomation")

    OnCreate {
      registerActivityEventListener()
    }

    OnDestroy {
      ScreenCaptureService.stop()
      try {
        context.stopService(Intent(context, ScreenCaptureService::class.java))
      } catch (_: Exception) {
      }
    }

    AsyncFunction("getUiTree") {
      service()?.getUiTree()
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("tapAt") { x: Int, y: Int ->
      service()?.tapAt(x, y)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("tapNode") { index: Int ->
      service()?.tapNode(index)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("type") { text: String ->
      service()?.typeText(text)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("swipe") { x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Int ->
      service()?.swipe(x1, y1, x2, y2, durationMs)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("longPress") { x: Int, y: Int, durationMs: Int ->
      service()?.longPress(x, y, durationMs)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("longPressNode") { index: Int, durationMs: Int ->
      service()?.longPressNode(index, durationMs)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("drag") { x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Int ->
      service()?.drag(x1, y1, x2, y2, durationMs)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("scroll") { direction: String ->
      service()?.scroll(direction)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("globalAction") { name: String ->
      service()?.performGlobalAction(name)
        ?: mapOf("success" to false, "error" to "The accessibility service is not connected. It may be enabled in Settings but stopped — reopen the app or re-toggle it in Settings -> Accessibility, then try again.")
    }

    AsyncFunction("isAccessibilityEnabled") {
      DeviceAutomationAccessibilityService.isConnected()
    }

    AsyncFunction("isAccessibilityPermissionGranted") {
      isAccessibilityPermissionGranted()
    }

    AsyncFunction("setProtectedApps") { packages: List<String> ->
      ProtectedApps.packages = packages.toSet()
      mapOf("success" to true, "count" to packages.size)
    }

    AsyncFunction("getForegroundApp") {
      val service = service()
      val packageName = service?.getForegroundPackage()
      if (packageName == null) {
        mapOf(
          "success" to false,
          "error" to "The accessibility service is not connected, so the foreground app cannot be determined.",
        )
      } else {
        mapOf("success" to true, "packageName" to packageName)
      }
    }

    AsyncFunction("setClipboard") { text: String ->
      if (isForegroundProtected()) {
        return@AsyncFunction mapOf(
          "success" to false,
          "error" to "The app on screen is on your do-not-touch list. The agent is not allowed to touch its clipboard."
        )
      }
      try {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("text", text))
        mapOf("success" to true)
      } catch (e: Exception) {
        Log.e(TAG, "setClipboard failed", e)
        mapOf("success" to false, "error" to (e.message ?: "Failed to set clipboard"))
      }
    }

    AsyncFunction("getClipboard") {
      if (isForegroundProtected()) {
        return@AsyncFunction mapOf(
          "success" to false,
          "error" to "The app on screen is on your do-not-touch list. The agent is not allowed to read its clipboard."
        )
      }
      try {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = clipboard.primaryClip
        val text = clip?.getItemAt(0)?.coerceToText(context)?.toString()
        if (text.isNullOrEmpty()) {
          mapOf(
            "success" to false,
            "error" to "Clipboard is empty or inaccessible. On Android 10+ the app may need to be in the foreground to read it.",
          )
        } else {
          mapOf("success" to true, "text" to text)
        }
      } catch (e: Exception) {
        Log.e(TAG, "getClipboard failed", e)
        mapOf("success" to false, "error" to (e.message ?: "Failed to read clipboard"))
      }
    }

    AsyncFunction("openAccessibilitySettings") {
      try {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      } catch (e: Exception) {
        Log.e(TAG, "openAccessibilitySettings failed", e)
        false
      }
    }

    AsyncFunction("openApp") { packageName: String ->
      if (ProtectedApps.isProtected(packageName)) {
        return@AsyncFunction mapOf(
          "success" to false,
          "error" to "$packageName is on your do-not-touch list. The agent is not allowed to open it.",
        )
      }
      try {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName)
        if (intent == null) {
          mapOf("success" to false, "error" to "App not installed or not launchable: $packageName")
        } else {
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
          mapOf("success" to true, "packageName" to packageName)
        }
      } catch (e: Exception) {
        Log.e(TAG, "openApp failed", e)
        mapOf("success" to false, "error" to (e.message ?: "Failed to open $packageName"))
      }
    }

    AsyncFunction("launchDeepLink") { uri: String ->
      val protectedTarget = resolveDeepLinkTarget(uri)
      if (protectedTarget != null) {
        return@AsyncFunction mapOf(
          "success" to false,
          "error" to "$protectedTarget is on your do-not-touch list. The agent is not allowed to open it.",
        )
      }
      try {
        val parsed = Uri.parse(uri)
        val intent = Intent(Intent.ACTION_VIEW, parsed).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(context.packageManager) == null) {
          mapOf("success" to false, "error" to "No app can handle link: $uri")
        } else {
          context.startActivity(intent)
          mapOf("success" to true, "uri" to uri)
        }
      } catch (e: Exception) {
        Log.e(TAG, "launchDeepLink failed", e)
        mapOf("success" to false, "error" to (e.message ?: "Failed to open link $uri"))
      }
    }

    AsyncFunction("listInstalledApps") {
      val pm = context.packageManager
      val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val activities = pm.queryIntentActivities(intent, 0)
      val seen = linkedSetOf<String>()
      activities
        .mapNotNull { it.activityInfo }
        .filter { seen.add(it.packageName) }
        .map { info ->
          val label = info.loadLabel(pm)?.toString() ?: info.packageName
          mapOf("packageName" to info.packageName, "label" to label)
        }
        .sortedBy { (it["label"] as? String ?: "").lowercase() }
    }

    AsyncFunction("installApk") { input: Map<String, Any?> ->
      val uri = input["uri"] as? String
      val url = input["url"] as? String
      val pick = input["pick"] == true
      when {
        pick -> {
          val picked = pickApkFileUri()
          if (picked == null) {
            mapOf("success" to false, "error" to "No APK file was selected.")
          } else {
            installApkStream(openStream(picked))
          }
        }
        uri != null -> installApkStream(openStream(uri))
        url != null -> {
          try {
            installApkStream(downloadApk(url))
          } catch (e: Exception) {
            Log.e(TAG, "installApk download failed", e)
            mapOf("success" to false, "error" to (e.message ?: "Download failed"))
          }
        }
        else -> mapOf("success" to false, "error" to "Provide either a file uri, a download url, or pick: true to select a file.")
      }
    }

    AsyncFunction("requestScreenCapturePermission") {
      requestScreenCapturePermission()
    }

    AsyncFunction("captureScreenshot") {
      if (isForegroundProtected()) {
        return@AsyncFunction mapOf(
          "success" to false,
          "error" to "The app on screen is on your do-not-touch list. The agent is not allowed to capture it.",
        )
      }
      if (!ScreenCaptureService.isActive()) {
        mapOf("success" to false, "error" to "Screen capture is not active. Call requestScreenCapturePermission first.")
      } else {
        val bitmap = ScreenCaptureService.captureFrame()
        if (bitmap == null) {
          mapOf("success" to false, "error" to "Could not grab a screen frame.")
        } else {
          val scaled = downscale(bitmap, 1024)
          val bytes = ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 75, out)
            out.toByteArray()
          }
          mapOf(
            "success" to true,
            "mimeType" to "image/jpeg",
            "imageBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
            "width" to scaled.width,
            "height" to scaled.height,
          )
        }
      }
    }

    AsyncFunction("stopScreenCapture") {
      val wasActive = ScreenCaptureService.stop()
      try {
        context.stopService(Intent(context, ScreenCaptureService::class.java))
      } catch (e: Exception) {
        Log.e(TAG, "stopScreenCapture failed", e)
      }
      mapOf("success" to true, "wasActive" to wasActive)
    }

    AsyncFunction("isScreenCaptureActive") {
      ScreenCaptureService.isActive()
    }
  }

  private fun service(): DeviceAutomationAccessibilityService? =
    DeviceAutomationAccessibilityService.getInstance()

  /** Whether the app currently on screen is on the do-not-touch list. */
  private fun isForegroundProtected(): Boolean {
    val service = service() ?: return false
    return ProtectedApps.isProtected(service.getForegroundPackage())
  }

  /** If a deep link resolves into a protected app, returns that package name, else null. */
  private fun resolveDeepLinkTarget(uri: String): String? {
    return try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      val resolveInfo = intent.resolveActivity(context.packageManager) ?: return null
      val packageName = resolveInfo.activityInfo?.packageName ?: return null
      if (ProtectedApps.isProtected(packageName)) packageName else null
    } catch (_: Exception) {
      null
    }
  }

  /**
   * Whether the user has granted our accessibility service in system settings.
   * Unlike [DeviceAutomationAccessibilityService.isConnected], this reads the
   * persistent Settings.Secure state and stays true even when the app process
   * was killed and the service has not been re-bound yet (which the system
   * surfaces as "Not working" in the Accessibility settings screen).
   */
  private fun isAccessibilityPermissionGranted(): Boolean {
    return try {
      val enabled = Settings.Secure.getInt(
        context.contentResolver,
        Settings.Secure.ACCESSIBILITY_ENABLED,
        0,
      ) == 1
      if (!enabled) return false
      val services = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: return false
      val componentName = ComponentName(context, DeviceAutomationAccessibilityService::class.java)
      services
        .split(':')
        .any { it.equals(componentName.flattenToString(), ignoreCase = true) }
    } catch (_: Exception) {
      false
    }
  }

  private fun registerActivityEventListener() {
    val reactContext = appContext.reactContext ?: return
    try {
      val addListener = reactContext.javaClass.methods.firstOrNull {
        it.name == "addActivityEventListener" && it.parameterCount == 1
      } ?: return
      val interfaceClass =
        Class.forName("com.facebook.react.bridge.ActivityEventListener")
      val listener = Proxy.newProxyInstance(
        interfaceClass.classLoader,
        arrayOf(interfaceClass),
        InvocationHandler { proxy, method, args ->
          when (method.name) {
            "onActivityResult" -> {
              val requestCode = (args?.getOrNull(1) as? Int) ?: 0
              val resultCode = (args?.getOrNull(2) as? Int) ?: 0
              val data = args?.getOrNull(3) as? Intent
              handleActivityResult(requestCode, resultCode, data)
              null
            }
            "onNewIntent" -> null
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> args?.getOrNull(0) === proxy
            "toString" -> "DeviceAutomationActivityEventListener"
            else -> null
          }
        },
      )
      addListener.invoke(reactContext, listener)
    } catch (e: Exception) {
      Log.e(TAG, "registerActivityEventListener failed", e)
    }
  }

  private fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    when (requestCode) {
      SCREEN_CAPTURE_REQUEST_CODE -> {
        val granted = resultCode == Activity.RESULT_OK && data != null
        if (granted) {
          val serviceIntent = Intent(context, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
          }
          startScreenCaptureService(serviceIntent)
        } else {
          pendingCaptureRequest?.complete(false)
          pendingCaptureRequest = null
        }
      }
      FILE_PICK_REQUEST_CODE -> {
        val picked = if (resultCode == Activity.RESULT_OK && data?.data != null) {
          val uri = data.data!!
          try {
            context.contentResolver.takePersistableUriPermission(
              uri,
              Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
          } catch (_: Exception) {
          }
          uri.toString()
        } else {
          null
        }
        pendingFilePick?.complete(picked)
        pendingFilePick = null
      }
    }
  }

  /**
   * Starts [ScreenCaptureService] for media projection.
   *
   * [Activity.onActivityResult] fires before the activity resumes, so at this
   * point Android still considers the app background. Starting the
   * mediaProjection foreground service from the background makes Android 13+
   * silently skip registering the FGS type, which then makes
   * [MediaProjectionManager.getMediaProjection] throw
   * "Media projections require a foreground service of type
   * FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION". Posting to the main looper defers
   * the start until the activity is actually back in the foreground. The
   * permission promise is only resolved once the capture service is up.
   */
  private fun startScreenCaptureService(serviceIntent: Intent) {
    mainHandler.post {
      try {
        context.startForegroundService(serviceIntent)
      } catch (e: Exception) {
        Log.e(TAG, "startForegroundService failed", e)
        pendingCaptureRequest?.complete(false)
        pendingCaptureRequest = null
        return@post
      }
      Thread {
        var active = false
        var waited = 0L
        while (waited < SCREEN_CAPTURE_START_TIMEOUT_MS) {
          if (ScreenCaptureService.isActive()) {
            active = true
            break
          }
          try {
            Thread.sleep(50)
          } catch (_: InterruptedException) {
            break
          }
          waited += 50
        }
        pendingCaptureRequest?.complete(active)
        pendingCaptureRequest = null
      }.start()
    }
  }

  private fun requestScreenCapturePermission(): Map<String, Any?> {
    val activity = appContext.currentActivity
      ?: return mapOf("success" to false, "error" to "No activity available to show the permission dialog.")
    val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    if (pendingCaptureRequest != null) {
      return mapOf("success" to false, "error" to "A screen capture request is already in progress.")
    }
    val future = CompletableFuture<Boolean>()
    pendingCaptureRequest = future
    activity.startActivityForResult(mpm.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST_CODE)
    val granted = try {
      future.get(120, TimeUnit.SECONDS)
    } catch (_: Exception) {
      pendingCaptureRequest = null
      false
    }
    return mapOf(
      "success" to granted,
      "granted" to granted,
      "error" to if (granted) null else "Screen capture permission was not granted.",
    )
  }

  private fun downscale(bitmap: Bitmap, maxDimension: Int): Bitmap {
    val width = bitmap.width
    val height = bitmap.height
    val largest = maxOf(width, height)
    if (largest <= maxDimension) return bitmap
    val scale = maxDimension.toFloat() / largest
    return Bitmap.createScaledBitmap(
      bitmap,
      (width * scale).toInt(),
      (height * scale).toInt(),
      true,
    )
  }

  private fun openStream(uriString: String): InputStream? {
    val uri = Uri.parse(uriString)
    return try {
      when (uri.scheme) {
        "content" -> context.contentResolver.openInputStream(uri)
        "file" -> {
          val file = File(uri.path!!)
          if (file.canRead()) FileInputStream(file) else resolveSharedStorageStream(uriString)
        }
        else -> null
      }
    } catch (e: Exception) {
      Log.e(TAG, "openStream failed for $uriString", e)
      null
    }
  }

  /**
   * A `file:///storage/emulated/0/...` path is often not readable directly from
   * this process. Resolve it to a content Uri via MediaStore so Downloads (and
   * other shared folders) become readable without the user having to grant a
   * storage permission.
   */
  private fun resolveSharedStorageStream(uriString: String): InputStream? {
    val name = Uri.parse(uriString).path?.substringAfterLast('/')
    if (name.isNullOrBlank()) return null
    val resolver = context.contentResolver
    if (Build.VERSION.SDK_INT >= 29) {
      val downloads = queryMediaStore(resolver, MediaStore.Downloads.EXTERNAL_CONTENT_URI, name)
      if (downloads != null) return resolver.openInputStream(downloads)
    }
    val files = queryMediaStore(resolver, MediaStore.Files.getContentUri("external"), name)
    if (files != null) return resolver.openInputStream(files)
    Log.e(TAG, "Could not resolve $uriString through MediaStore")
    return null
  }

  private fun queryMediaStore(resolver: android.content.ContentResolver, collection: Uri, name: String): Uri? {
    return try {
      resolver.query(
        collection,
        arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME),
        "${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
        arrayOf(name),
        null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          ContentUris.withAppendedId(collection, cursor.getLong(0))
        } else {
          null
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "MediaStore query failed", e)
      null
    }
  }

  private fun pickApkFileUri(): String? {
    val activity = appContext.currentActivity ?: return null
    if (pendingFilePick != null) return null
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "application/vnd.android.package-archive"
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    val future = CompletableFuture<String?>()
    pendingFilePick = future
    try {
      activity.startActivityForResult(intent, FILE_PICK_REQUEST_CODE)
    } catch (e: Exception) {
      Log.e(TAG, "pickApkFile failed", e)
      pendingFilePick = null
      return null
    }
    return try {
      future.get(120, TimeUnit.SECONDS)
    } catch (_: Exception) {
      pendingFilePick = null
      null
    }
  }

  private fun downloadApk(url: String): InputStream {
    val target = File(context.cacheDir, "install-${System.currentTimeMillis()}.apk")
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = true
      connectTimeout = 30_000
      readTimeout = 120_000
      requestMethod = "GET"
    }
    try {
      val code = connection.responseCode
      if (code !in 200..299) throw IllegalStateException("Download failed: HTTP $code")
      connection.inputStream.use { input ->
        FileOutputStream(target).use { out ->
          input.copyTo(out, 128 * 1024)
        }
      }
    } finally {
      connection.disconnect()
    }
    if (target.length() == 0L) throw IllegalStateException("Downloaded file is empty")
    return FileInputStream(target)
  }

  private fun installApkStream(input: InputStream?): Map<String, Any?> {
    if (input == null) {
      return mapOf(
        "success" to false,
        "status" to "cannot_open",
        "error" to "Cannot open the APK file. If it lives in shared storage (e.g. Downloads), call installApk with pick: true so the user can select the file.",
      )
    }
    if (!context.packageManager.canRequestPackageInstalls()) {
      return mapOf(
        "success" to false,
        "status" to "unknown_sources_disabled",
        "error" to "Mobile Agent is not allowed to install apps. Ask the user to allow 'Install unknown apps' for this app in Settings, then retry.",
      )
    }
    var sessionId = -1
    return try {
      val packageInstaller = context.packageManager.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
      sessionId = packageInstaller.createSession(params)
      val session = packageInstaller.openSession(sessionId)
      try {
        input.use { stream ->
          session.openWrite("base.apk", 0, -1).use { out ->
            stream.copyTo(out, 128 * 1024)
            session.fsync(out)
          }
        }
        val pendingIntent = PendingIntent.getBroadcast(
          context,
          sessionId,
          Intent(context, InstallStatusReceiver::class.java),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val future = CompletableFuture<InstallStatus>()
        InstallStatusReceiver.register(sessionId, future)
        session.commit(pendingIntent.intentSender)
        val status = try {
          future.get(180, TimeUnit.SECONDS)
        } catch (e: TimeoutException) {
          InstallStatusReceiver.unregister(sessionId)
          return mapOf(
            "success" to false,
            "status" to "timeout",
            "error" to "Install timed out waiting for confirmation. The system installer may still be on screen — read the screen and confirm, then check whether the app was installed.",
          )
        } catch (e: Exception) {
          InstallStatusReceiver.unregister(sessionId)
          throw e
        }
        installStatusResult(status, sessionId)
      } finally {
        session.close()
      }
    } catch (e: Exception) {
      Log.e(TAG, "installApk failed", e)
      if (sessionId != -1) {
        try {
          context.packageManager.packageInstaller.abandonSession(sessionId)
        } catch (_: Exception) {
        }
      }
      mapOf("success" to false, "status" to "failed", "error" to (e.message ?: "Install failed"))
    }
  }

  private fun installStatusResult(info: InstallStatus, sessionId: Int): Map<String, Any?> {
    return when (info.status) {
      PackageInstaller.STATUS_SUCCESS -> {
        val packageName = info.packageName
        val verified = packageName != null && isPackageInstalled(packageName)
        if (packageName != null && !verified) {
          mapOf(
            "success" to false,
            "status" to "failed",
            "packageName" to packageName,
            "error" to "The installer reported success for $packageName but the app is not installed. Unknown sources may be blocked for this app.",
          )
        } else {
          mapOf(
            "success" to true,
            "status" to "installed",
            "packageName" to packageName,
            "verified" to verified,
            "sessionId" to sessionId,
          )
        }
      }
      PackageInstaller.STATUS_PENDING_USER_ACTION -> mapOf(
        "success" to false,
        "status" to "user_action_required",
        "packageName" to info.packageName,
        "error" to "The system installer requires confirmation. Read the screen and tap the install/update button, then check whether the app is installed.",
      )
      else -> mapOf(
        "success" to false,
        "status" to "failed",
        "packageName" to info.packageName,
        "rawStatus" to info.status,
        "legacyStatus" to info.legacyStatus,
        "error" to buildString {
          append("Install failed (status ${info.status})")
          if (!info.message.isNullOrBlank()) append(": ${info.message}")
          append(".")
        },
      )
    }
  }

  private fun isPackageInstalled(packageName: String): Boolean {
    return try {
      context.packageManager.getPackageInfo(packageName, 0)
      true
    } catch (_: Exception) {
      false
    }
  }
}
