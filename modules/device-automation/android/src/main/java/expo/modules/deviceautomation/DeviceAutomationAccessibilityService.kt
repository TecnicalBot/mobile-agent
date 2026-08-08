package expo.modules.deviceautomation

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityService.GestureResultCallback
import android.accessibilityservice.AccessibilityService.ScreenshotResult
import android.accessibilityservice.AccessibilityService.TakeScreenshotCallback
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * AccessibilityService that gives the agent the ability to perceive the
 * current screen (serialized UI tree) and drive it (taps, swipes, typing,
 * global actions) using native OS APIs. This is the foundation of device
 * automation: it works on any app, requires no root and no ADB.
 *
 * All node access happens on the main thread through [runOnMain] because
 * [AccessibilityNodeInfo] is not thread-safe. Gestures are dispatched on the
 * main thread but awaited off it via [GestureResultCallback], so the reported
 * success/failure reflects whether the gesture actually completed rather than
 * merely whether it was accepted for dispatch.
 */
class DeviceAutomationAccessibilityService : AccessibilityService() {
  companion object {
    private const val TAG = "DeviceAutomationAccessibility"
    private var instance: DeviceAutomationAccessibilityService? = null

    const val MAX_NODES = 250
    const val MAX_DEPTH = 24

    /** Android enforces a minimum interval between a11y screenshots; retry after this delay. */
    private const val SCREENSHOT_RETRY_DELAY_MS = 500L

    fun getInstance(): DeviceAutomationAccessibilityService? = instance

    fun isConnected(): Boolean = instance != null
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  /** Bumped whenever the active window's tree is likely stale (window/content changes). */
  @Volatile
  private var treeGeneration = 0L

  /** Uptime of the last accessibility event; used by [waitForIdle]. */
  @Volatile
  private var lastEventTimestamp = 0L

  /** Most recent serialized snapshot, reused while the tree generation is unchanged. */
  @Volatile
  private var cachedSnapshot: Snapshot? = null

  private class Snapshot(
    val generation: Long,
    val nodes: List<AccessibilityNodeInfo>,
    val serialized: List<Map<String, Any?>>,
    val fingerprints: LongArray,
    val screenWidth: Int,
    val screenHeight: Int,
    val truncated: Boolean,
    val foregroundPackage: String?,
  )

  private class MainThreadFailure(cause: Throwable?) :
    RuntimeException(cause?.message ?: "Main thread call failed", cause)

  private class TakeScreenshotFailure(val code: Int) :
    RuntimeException("Screenshot failed (error code $code)")

  private sealed class Step<out T> {
    class Error(val message: String) : Step<Nothing>()
    class Ok<out T>(val value: T) : Step<T>()
  }

  private sealed class TapStep {
    class Blocked(val error: String) : TapStep()
    class Missing(val error: String) : TapStep()
    object Clicked : TapStep()
    class NeedGesture(val center: Pair<Int, Int>) : TapStep()
  }

  private class ScrollTarget(val node: AccessibilityNodeInfo, val bounds: Rect)

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    lastEventTimestamp = SystemClock.uptimeMillis()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    lastEventTimestamp = SystemClock.uptimeMillis()
    val type = event.eventType
    if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      type == AccessibilityEvent.TYPE_WINDOWS_CHANGED ||
      type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
    ) {
      treeGeneration++
    }
  }

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    instance = null
    cachedSnapshot = null
    super.onDestroy()
  }

  // -------------------------------------------------------------------------
  // Perception
  // -------------------------------------------------------------------------

  /** Package name of the currently focused app, or null when unavailable. */
  fun getForegroundPackage(): String? = try {
    runOnMain { rootInActiveWindow?.packageName?.toString() }
  } catch (_: Exception) {
    null
  }

  /** Refuse perception/input when the foreground app is on the do-not-touch list. */
  private fun blockedIfProtected(): Map<String, Any?>? {
    val packageName = rootInActiveWindow?.packageName?.toString()
    if (!ProtectedApps.isProtected(packageName)) return null
    return mapOf(
      "success" to false,
      "error" to "This app ($packageName) is on your do-not-touch list. The agent is not allowed to read or control it. Use back/home to navigate away.",
    )
  }

  /** Serialize the current window's UI tree into a compact, LLM-friendly list of nodes. */
  fun getUiTree(): Map<String, Any?> = try {
    runOnMain {
      blockedIfProtected()?.let { return@runOnMain it }
      val root = pickRoot()
      if (root == null) {
        return@runOnMain mapOf(
          "success" to false,
          "error" to "No active window available. Is the accessibility service enabled and the screen unlocked?",
        )
      }
      cachedNodes()
      val snapshot = cachedSnapshot ?: return@runOnMain mapOf(
        "success" to false,
        "error" to "No active window available. Is the accessibility service enabled and the screen unlocked?",
      )
      mapOf(
        "success" to true,
        "nodeCount" to snapshot.serialized.size,
        "nodes" to snapshot.serialized,
        "truncated" to snapshot.truncated,
        "screenWidth" to snapshot.screenWidth,
        "screenHeight" to snapshot.screenHeight,
        "snapshotId" to snapshot.generation,
      )
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Failed to read the screen."))
  }

  /** Prefer the active app window; fall back to a non-keyboard window when the IME hijacks it. */
  private fun pickRoot(): AccessibilityNodeInfo? {
    val active = rootInActiveWindow
    if (active != null && !isKeyboardNode(active)) return active
    for (window in windows) {
      val root = try {
        window.root
      } catch (_: Exception) {
        null
      } ?: continue
      if (!isKeyboardNode(root)) return root
    }
    return active
  }

  /** Whether the node belongs to a soft-keyboard (IME) window, which should never reach the model. */
  private fun isKeyboardNode(node: AccessibilityNodeInfo): Boolean {
    val className = node.className?.toString() ?: ""
    val pkg = node.packageName?.toString() ?: ""
    return className.contains("Keyboard") ||
      pkg.contains("inputmethod") ||
      pkg.contains("honeyboard") ||
      pkg.contains("swiftkey")
  }

  /**
   * Cached node list for the current tree generation. Re-traverses and
   * re-serializes only when the tree generation changed, so index-based
   * actions and repeated reads on an unchanged screen avoid re-walking the
   * whole accessibility tree. Must run on the main thread.
   */
  private fun cachedNodes(forceRefresh: Boolean = false): List<AccessibilityNodeInfo> {
    val snapshot = cachedSnapshot
    if (!forceRefresh && snapshot != null && snapshot.generation == treeGeneration) {
      return snapshot.nodes
    }
    val root = pickRoot() ?: return snapshot?.nodes ?: emptyList()
    val (screenWidth, screenHeight) = screenSize()
    val nodes = mutableListOf<AccessibilityNodeInfo>()
    collectNodes(root, 0, nodes, screenWidth, screenHeight)
    val serialized = nodes.mapIndexed { index, node -> serializeNode(node, index) }
    val fingerprints = LongArray(nodes.size) { fingerprint(nodes[it]) }
    cachedSnapshot = Snapshot(
      generation = treeGeneration,
      nodes = nodes,
      serialized = serialized,
      fingerprints = fingerprints,
      screenWidth = screenWidth,
      screenHeight = screenHeight,
      truncated = nodes.size >= MAX_NODES,
      foregroundPackage = root.packageName?.toString(),
    )
    return nodes
  }

  /**
   * Resolve a node by index, guarding against stale indices: when the tree was
   * refreshed since the last snapshot, the node at [index] must still match the
   * previous snapshot's fingerprint, otherwise the screen changed and the index
   * may point at a different element. Returns (node, error).
   */
  private fun nodeAt(index: Int): Pair<AccessibilityNodeInfo?, String?> {
    val previous = cachedSnapshot
    val refresh = previous == null || previous.generation != treeGeneration
    val nodes = cachedNodes(forceRefresh = refresh)
    val node = nodes.getOrNull(index)
    if (node == null) {
      return null to "No node with index $index. Re-read the screen."
    }
    val current = cachedSnapshot
    if (refresh && previous != null && index < previous.fingerprints.size &&
      current != null && index < current.fingerprints.size &&
      previous.fingerprints[index] != current.fingerprints[index]
    ) {
      return null to "The screen changed since the last read; node index $index no longer matches. Call readScreen again, then retry."
    }
    return node to null
  }

  /** Depth-first, filtered traversal that yields the nodes exposed to the model. */
  private fun collectNodes(
    node: AccessibilityNodeInfo,
    depth: Int,
    out: MutableList<AccessibilityNodeInfo>,
    screenWidth: Int,
    screenHeight: Int,
    parentText: String? = null,
    parentDescription: String? = null,
    parentAdded: Boolean = false,
  ) {
    if (out.size >= MAX_NODES) return
    if (depth > MAX_DEPTH) return
    if (!node.isVisibleToUser) return

    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    if (bounds.width() <= 0 || bounds.height() <= 0) return
    // Skip nodes fully outside the screen (scrolled-out content still reported as visible).
    if (bounds.right <= 0 || bounds.bottom <= 0 ||
      bounds.left >= screenWidth || bounds.top >= screenHeight
    ) return
    if (isKeyboardNode(node)) return

    val actionable = node.isClickable || node.isScrollable || node.isEditable || node.isCheckable
    val text = getNodeText(node)
    val description = node.contentDescription?.toString()

    // Skip non-actionable children that merely duplicate their parent's label
    // (common in Compose/RecyclerView rows) to shrink the tree and avoid tapping noise.
    if (parentAdded && !actionable && !text.isNullOrEmpty() && text == parentText) return
    if (parentAdded && !actionable && text.isNullOrEmpty() &&
      !description.isNullOrEmpty() && description == parentDescription
    ) return

    // Include labeled or actionable nodes, and leaf nodes (which may matter even
    // when unlabeled). Skip pure container nodes to keep the tree small.
    val added = hasLabel(text, description) || actionable || node.childCount == 0
    if (added) {
      out.add(node)
    }

    for (i in 0 until node.childCount) {
      val child = try {
        node.getChild(i)
      } catch (_: Exception) {
        null
      } ?: continue
      collectNodes(child, depth + 1, out, screenWidth, screenHeight, text, description, added)
    }
  }

  private fun hasLabel(text: String?, description: String?): Boolean =
    !text.isNullOrBlank() || !description.isNullOrBlank()

  private fun serializeNode(node: AccessibilityNodeInfo, index: Int): Map<String, Any?> {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    return mapOf(
      "index" to index,
      "role" to classifyRole(node),
      "text" to (getNodeText(node) ?: ""),
      "description" to (node.contentDescription?.toString() ?: ""),
      "resourceId" to (node.viewIdResourceName ?: ""),
      "bounds" to listOf(bounds.left, bounds.top, bounds.width(), bounds.height()),
      "clickable" to node.isClickable,
      "scrollable" to node.isScrollable,
      "editable" to node.isEditable,
      "focused" to node.isFocused,
      "checkable" to node.isCheckable,
      "checked" to (if (node.isCheckable) node.isChecked else null),
      "enabled" to node.isEnabled,
      "selected" to node.isSelected,
    )
  }

  private fun getNodeText(node: AccessibilityNodeInfo): String? {
    val text = node.text
    if (!text.isNullOrEmpty()) return text.toString()
    return node.contentDescription?.toString()
  }

  /** Stable-ish identity for a node within a snapshot, used to detect stale indices. */
  private fun fingerprint(node: AccessibilityNodeInfo): Long {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    var hash = 1125899906842597L
    fun mix(value: String?) {
      hash = hash * 31 + (value?.hashCode() ?: 0)
    }
    mix(node.packageName?.toString())
    mix(node.className?.toString())
    mix(node.text?.toString())
    mix(node.contentDescription?.toString())
    mix(node.viewIdResourceName)
    hash = hash * 31 + bounds.left
    hash = hash * 31 + bounds.top
    hash = hash * 31 + bounds.width()
    hash = hash * 31 + bounds.height()
    hash = hash * 31 + (if (node.isClickable) 1 else 0)
    return hash
  }

  private fun classifyRole(node: AccessibilityNodeInfo): String {
    val className = node.className?.toString() ?: return "view"
    return when {
      className.contains("EditText") -> "text_field"
      className.contains("Button") || className.contains("MaterialButton") -> "button"
      className.contains("Switch") -> "switch"
      className.contains("CheckBox") || className.contains("Checkbox") -> "checkbox"
      className.contains("RadioButton") -> "radio_button"
      className.contains("ImageButton") || className.contains("ImageView") -> "image"
      className.contains("TextView") || className.contains("MaterialTextView") -> "text"
      className.contains("RecyclerView") || className.contains("ListView") -> "list"
      className.contains("ScrollView") || className.contains("NestedScrollView") -> "scrollable"
      className.contains("WebView") -> "web_view"
      className.contains("TabLayout") || className.contains("TabView") -> "tab"
      className.contains("Toolbar") || className.contains("ActionBar") -> "toolbar"
      className.contains("Spinner") || className.contains("DropdownMenu") -> "dropdown"
      className.contains("SeekBar") || className.contains("Slider") -> "slider"
      else -> className.substringAfterLast(".").lowercase()
    }
  }

  // -------------------------------------------------------------------------
  // Screenshots (a11y fast path, API 30+)
  // -------------------------------------------------------------------------

  /**
   * Capture the screen through the accessibility service (API 30+). No consent,
   * no notification, no foreground service. Returns null when unsupported or
   * when the capture failed. Rate-limit failures are retried once.
   */
  fun takeScreenshot(timeoutMs: Long = 2000): Bitmap? {
    if (Build.VERSION.SDK_INT < 30) return null
    val future = CompletableFuture<ScreenshotResult>()
    val executor = Executor { it.run() }
    val callback = object : TakeScreenshotCallback {
      override fun onSuccess(screenshot: ScreenshotResult) {
        future.complete(screenshot)
      }

      override fun onFailure(errorCode: Int) {
        if (errorCode == ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) {
          mainHandler.postDelayed({
            try {
              takeScreenshot(
                Display.DEFAULT_DISPLAY,
                executor,
                object : TakeScreenshotCallback {
                  override fun onSuccess(s: ScreenshotResult) {
                    future.complete(s)
                  }

                  override fun onFailure(code: Int) {
                    future.completeExceptionally(TakeScreenshotFailure(code))
                  }
                },
              )
            } catch (e: Exception) {
              future.completeExceptionally(e)
            }
          }, SCREENSHOT_RETRY_DELAY_MS)
        } else {
          future.completeExceptionally(TakeScreenshotFailure(errorCode))
        }
      }
    }
    return try {
      takeScreenshot(Display.DEFAULT_DISPLAY, executor, callback)
      val result = future.get(timeoutMs, TimeUnit.MILLISECONDS)
      val buffer = result.hardwareBuffer
      try {
        Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)
      } finally {
        buffer.close()
      }
    } catch (_: Exception) {
      null
    }
  }

  // -------------------------------------------------------------------------
  // Waiting primitives
  // -------------------------------------------------------------------------

  /**
   * Returns true once no accessibility events have fired for [quietMs], or when
   * [timeoutMs] elapses. Lets the agent let animations/transitions settle before
   * re-reading the screen, instead of polling readScreen.
   */
  fun waitForIdle(quietMs: Int, timeoutMs: Int): Boolean {
    return try {
      val deadline = SystemClock.uptimeMillis() + timeoutMs
      while (SystemClock.uptimeMillis() < deadline) {
        if (SystemClock.uptimeMillis() - lastEventTimestamp >= quietMs) return true
        Thread.sleep(50)
      }
      SystemClock.uptimeMillis() - lastEventTimestamp >= quietMs
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
  }

  /** Returns true once [packageName] is the foreground app, or when [timeoutMs] elapses. */
  fun waitForPackage(packageName: String, timeoutMs: Int): Boolean {
    return try {
      val deadline = SystemClock.uptimeMillis() + timeoutMs
      while (SystemClock.uptimeMillis() < deadline) {
        val current = getForegroundPackage()
        if (current != null && current == packageName) return true
        Thread.sleep(50)
      }
      getForegroundPackage() == packageName
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
  }

  // -------------------------------------------------------------------------
  // Action primitives
  // -------------------------------------------------------------------------

  fun tapAt(x: Int, y: Int): Map<String, Any?> = try {
    val step = runOnMain {
      blockedIfProtected()?.let { Step.Error(it["error"] as? String ?: "Blocked") } ?: run {
        val (cx, cy) = clampToScreen(x, y)
        val gesture = tapGesture(cx, cy)
        Step.Ok(dispatchGestureAsync(gesture) ?: return@run Step.Error("Tap gesture was rejected by the system."))
      }
    }
    when (step) {
      is Step.Error -> mapOf("success" to false, "error" to step.message)
      is Step.Ok -> awaitGesture(step.value, tapDuration().toInt())
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Tap failed."))
  }

  fun tapNode(index: Int): Map<String, Any?> = try {
    val step = runOnMain {
      blockedIfProtected()?.let { TapStep.Blocked(it["error"] as? String ?: "Blocked") } ?: run {
        val (node, error) = nodeAt(index)
        if (node == null) {
          TapStep.Missing(error ?: "No node with index $index. Re-read the screen.")
        } else if (tryClickNode(node)) {
          TapStep.Clicked
        } else {
          TapStep.NeedGesture(nodeCenter(node))
        }
      }
    }
    when (step) {
      is TapStep.Blocked -> mapOf("success" to false, "error" to step.error)
      is TapStep.Missing -> mapOf("success" to false, "error" to step.error)
      is TapStep.Clicked -> mapOf("success" to true, "index" to index)
      is TapStep.NeedGesture -> {
        val (cx, cy) = step.center
        val dispatch = runOnMain {
          Step.Ok(dispatchGestureAsync(tapGesture(cx, cy)) ?: return@runOnMain Step.Error("Tap gesture was rejected by the system."))
        }
        when (dispatch) {
          is Step.Error -> mapOf("success" to false, "error" to dispatch.message)
          is Step.Ok -> awaitGesture(dispatch.value, tapDuration().toInt())
        }
      }
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Tap failed."))
  }

  /**
   * Programmatic click: the node itself, else the nearest clickable ancestor
   * (Compose/RecyclerView rows are often clickable only on the container), else
   * a coordinate gesture at the node center. Must run on the main thread.
   */
  private fun tryClickNode(node: AccessibilityNodeInfo): Boolean {
    var current: AccessibilityNodeInfo? = node
    var depth = 0
    while (current != null && depth < 8) {
      if (current.isClickable) {
        return try {
          current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } catch (_: Exception) {
          false
        }
      }
      current = try {
        current.parent
      } catch (_: Exception) {
        null
      }
      depth++
    }
    return false
  }

  fun typeText(text: String): Map<String, Any?> = try {
    runOnMain {
      blockedIfProtected()?.let {
        return@runOnMain mapOf("success" to false, "error" to (it["error"] as? String ?: "Blocked"))
      }
      val nodes = cachedNodes()
      val target = nodes.firstOrNull { it.isFocused && it.isEditable }
        ?: nodes.firstOrNull { it.isEditable }

      if (target == null) {
        return@runOnMain mapOf(
          "success" to false,
          "error" to "No editable text field found. Tap a text field first.",
        )
      }

      if (!target.isFocused) {
        target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
      }

      val setText = target.performAction(
        AccessibilityNodeInfo.ACTION_SET_TEXT,
        Bundle().apply {
          putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        },
      )

      if (setText) verifyText(target, text) else typeCharByChar(target, text)
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Typing failed."))
  }

  private fun verifyText(node: AccessibilityNodeInfo, expected: String): Map<String, Any?> {
    val actual = try {
      node.text?.toString()
    } catch (_: Exception) {
      null
    }
    return if (actual == expected) {
      mapOf("success" to true)
    } else {
      mapOf(
        "success" to false,
        "error" to buildString {
          append("The text field did not accept the whole text.")
          if (!actual.isNullOrEmpty()) append(" It currently contains: \"$actual\".")
          append(" Clear the field and retry, or use the clipboard/paste approach instead.")
        },
      )
    }
  }

  /** Fallback that sets text one accumulated character at a time, for apps that reject whole-text injection. */
  private fun typeCharByChar(node: AccessibilityNodeInfo, text: String): Map<String, Any?> {
    val accumulated = StringBuilder()
    for (char in text) {
      accumulated.append(char)
      val ok = node.performAction(
        AccessibilityNodeInfo.ACTION_SET_TEXT,
        Bundle().apply {
          putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            accumulated.toString(),
          )
        },
      )
      if (!ok) {
        return mapOf(
          "success" to false,
          "error" to buildString {
            append("The app rejected programmatic text input at character ${accumulated.length}.")
            if (accumulated.isNotEmpty()) append(" Entered so far: \"$accumulated\".")
          },
        )
      }
    }
    return mapOf("success" to true)
  }

  fun swipe(
    x1: Int,
    y1: Int,
    x2: Int,
    y2: Int,
    durationMs: Int,
  ): Map<String, Any?> = swipeGesture(x1, y1, x2, y2, durationMs.coerceAtLeast(100))

  fun longPress(x: Int, y: Int, durationMs: Int): Map<String, Any?> = try {
    val pressMs = durationMs.coerceAtLeast(200)
    val step = runOnMain {
      blockedIfProtected()?.let { Step.Error(it["error"] as? String ?: "Blocked") } ?: run {
        val (cx, cy) = clampToScreen(x, y)
        val gesture = GestureDescription.Builder()
          .addStroke(
            GestureDescription.StrokeDescription(
              Path().apply { moveTo(cx.toFloat(), cy.toFloat()) },
              0,
              pressMs.toLong(),
            ),
          )
          .build()
        Step.Ok(dispatchGestureAsync(gesture) ?: return@run Step.Error("Long-press gesture was rejected by the system."))
      }
    }
    when (step) {
      is Step.Error -> mapOf("success" to false, "error" to step.message)
      is Step.Ok -> awaitGesture(step.value, pressMs)
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Long-press failed."))
  }

  fun longPressNode(index: Int, durationMs: Int): Map<String, Any?> = try {
    val pressMs = durationMs.coerceAtLeast(200)
    val step = runOnMain {
      blockedIfProtected()?.let { Step.Error(it["error"] as? String ?: "Blocked") } ?: run {
        val (node, error) = nodeAt(index)
        if (node == null) {
          Step.Error(error ?: "No node with index $index. Re-read the screen.")
        } else {
          Step.Ok(nodeCenter(node))
        }
      }
    }
    when (step) {
      is Step.Error -> mapOf("success" to false, "error" to step.message)
      is Step.Ok -> {
        val (cx, cy) = step.value
        val dispatch = runOnMain {
          val gesture = GestureDescription.Builder()
            .addStroke(
              GestureDescription.StrokeDescription(
                Path().apply { moveTo(cx.toFloat(), cy.toFloat()) },
                0,
                pressMs.toLong(),
              ),
            )
            .build()
          Step.Ok(dispatchGestureAsync(gesture) ?: return@runOnMain Step.Error("Long-press gesture was rejected by the system."))
        }
        when (dispatch) {
          is Step.Error -> mapOf("success" to false, "error" to dispatch.message)
          is Step.Ok -> awaitGesture(dispatch.value, pressMs)
        }
      }
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Long-press failed."))
  }

  /** Press-and-drag from one point to another (slow swipe), for pick-and-place interactions. */
  fun drag(
    x1: Int,
    y1: Int,
    x2: Int,
    y2: Int,
    durationMs: Int,
  ): Map<String, Any?> = swipeGesture(x1, y1, x2, y2, durationMs.coerceAtLeast(400))

  fun scroll(direction: String): Map<String, Any?> {
    if (direction !in setOf("up", "down", "left", "right")) {
      return mapOf("success" to false, "error" to "Unknown direction: $direction")
    }
    return try {
      val step = runOnMain {
        blockedIfProtected()?.let { Step.Error(it["error"] as? String ?: "Blocked") } ?: run {
          val target = cachedNodes()
            .filter { it.isScrollable }
            .maxByOrNull { node ->
              val r = Rect()
              node.getBoundsInScreen(r)
              r.width().toLong() * r.height()
            }
          if (target == null) {
            Step.Error("No scrollable area found.")
          } else {
            val bounds = Rect()
            target.getBoundsInScreen(bounds)
            Step.Ok(ScrollTarget(target, bounds))
          }
        }
      }
      when (step) {
        is Step.Error -> mapOf("success" to false, "error" to step.message)
        is Step.Ok -> {
          val target = step.value
          val semanticallyScrolled = runOnMain {
            val action = if (direction == "up" || direction == "left") {
              AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            } else {
              AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
            }
            try {
              target.node.performAction(action)
            } catch (_: Exception) {
              false
            }
          }
          if (semanticallyScrolled) {
            mapOf("success" to true, "via" to "semantic")
          } else {
            val bounds = target.bounds
            val gestureResult = when (direction) {
              "up" -> swipeGesture(
                bounds.left + bounds.width() / 2,
                bounds.top + bounds.height() * 4 / 5,
                bounds.left + bounds.width() / 2,
                bounds.top + bounds.height() / 5,
                250,
              )
              "down" -> swipeGesture(
                bounds.left + bounds.width() / 2,
                bounds.top + bounds.height() / 5,
                bounds.left + bounds.width() / 2,
                bounds.top + bounds.height() * 4 / 5,
                250,
              )
              "left" -> swipeGesture(
                bounds.left + bounds.width() * 4 / 5,
                bounds.top + bounds.height() / 2,
                bounds.left + bounds.width() / 5,
                bounds.top + bounds.height() / 2,
                250,
              )
              else -> swipeGesture(
                bounds.left + bounds.width() / 5,
                bounds.top + bounds.height() / 2,
                bounds.left + bounds.width() * 4 / 5,
                bounds.top + bounds.height() / 2,
                250,
              )
            }
            if (gestureResult["success"] == true) {
              mapOf("success" to true, "via" to "gesture")
            } else {
              mapOf("success" to false, "error" to "Scroll failed: neither the semantic action nor a swipe gesture worked.")
            }
          }
        }
      }
    } catch (e: Exception) {
      mapOf("success" to false, "error" to (e.message ?: "Scroll failed."))
    }
  }

  fun performGlobalAction(name: String): Map<String, Any?> = try {
    val action = when (name) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
      "power_dialog" -> GLOBAL_ACTION_POWER_DIALOG
      else -> return mapOf("success" to false, "error" to "Unknown global action: $name")
    }
    mapOf("success" to runOnMain { performGlobalAction(action) })
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Action failed."))
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private fun swipeGesture(
    x1: Int,
    y1: Int,
    x2: Int,
    y2: Int,
    durationMs: Int,
  ): Map<String, Any?> = try {
    val duration = durationMs.coerceAtLeast(100)
    val step = runOnMain {
      blockedIfProtected()?.let { Step.Error(it["error"] as? String ?: "Blocked") } ?: run {
        val (cx1, cy1) = clampToScreen(x1, y1)
        val (cx2, cy2) = clampToScreen(x2, y2)
        val gesture = GestureDescription.Builder()
          .addStroke(
            GestureDescription.StrokeDescription(
              Path().apply {
                moveTo(cx1.toFloat(), cy1.toFloat())
                lineTo(cx2.toFloat(), cy2.toFloat())
              },
              0,
              duration.toLong(),
            ),
          )
          .build()
        Step.Ok(dispatchGestureAsync(gesture) ?: return@run Step.Error("Swipe gesture was rejected by the system."))
      }
    }
    when (step) {
      is Step.Error -> mapOf("success" to false, "error" to step.message)
      is Step.Ok -> awaitGesture(step.value, duration)
    }
  } catch (e: Exception) {
    mapOf("success" to false, "error" to (e.message ?: "Swipe failed."))
  }

  private fun tapGesture(cx: Int, cy: Int): GestureDescription {
    return GestureDescription.Builder()
      .addStroke(
        GestureDescription.StrokeDescription(
          Path().apply { moveTo(cx.toFloat(), cy.toFloat()) },
          0,
          tapDuration(),
        ),
      )
      .build()
  }

  /** Match the platform's tap timeout so the gesture is accepted as a tap, not a long-press. */
  private fun tapDuration(): Long = ViewConfiguration.getTapTimeout().toLong()

  private fun nodeCenter(node: AccessibilityNodeInfo): Pair<Int, Int> {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    return (bounds.left + bounds.width() / 2) to (bounds.top + bounds.height() / 2)
  }

  private fun screenSize(): Pair<Int, Int> {
    val root = rootInActiveWindow
    val bounds = Rect()
    root?.getBoundsInScreen(bounds)
    val metrics = resources.displayMetrics
    val width = if (bounds.width() > 0) bounds.width() else metrics.widthPixels
    val height = if (bounds.height() > 0) bounds.height() else metrics.heightPixels
    return width to height
  }

  /** Clamp to the active window's bounds so taps near status/nav bars land on the app. */
  private fun clampToScreen(x: Int, y: Int): Pair<Int, Int> {
    val root = rootInActiveWindow
    val maxX: Int
    val maxY: Int
    if (root != null) {
      val bounds = Rect()
      root.getBoundsInScreen(bounds)
      maxX = (bounds.right - 1).coerceAtLeast(0)
      maxY = (bounds.bottom - 1).coerceAtLeast(0)
    } else {
      val metrics = resources.displayMetrics
      maxX = (metrics.widthPixels - 1).coerceAtLeast(0)
      maxY = (metrics.heightPixels - 1).coerceAtLeast(0)
    }
    return x.coerceIn(0, maxX) to y.coerceIn(0, maxY)
  }

  /**
   * Dispatch a gesture on the main thread and return a future that completes
   * with the gesture result via [GestureResultCallback]. Returns null when the
   * system rejects the gesture outright. Must run on the main thread.
   */
  private fun dispatchGestureAsync(gesture: GestureDescription): CompletableFuture<Boolean>? {
    val future = CompletableFuture<Boolean>()
    val dispatched = try {
      dispatchGesture(
        gesture,
        object : GestureResultCallback() {
          override fun onCompleted(g: GestureDescription) {
            future.complete(true)
          }

          override fun onCancelled(g: GestureDescription) {
            future.complete(false)
          }
        },
        null,
      )
    } catch (e: Exception) {
      Log.e(TAG, "dispatchGesture failed", e)
      future.complete(false)
      true
    }
    return if (dispatched) future else null
  }

  /** Await the outcome of a dispatched gesture; the wait happens off the main thread. */
  private fun awaitGesture(future: CompletableFuture<Boolean>, durationMs: Int): Map<String, Any?> {
    val completed = try {
      future.get(durationMs.toLong() + 1500L, TimeUnit.MILLISECONDS)
    } catch (_: Exception) {
      false
    }
    return if (completed) {
      mapOf("success" to true)
    } else {
      mapOf("success" to false, "error" to "The gesture did not complete (cancelled by the system or timed out).")
    }
  }

  /**
   * Run [callable] on the main thread and await the result. Unlike a null-returning
   * variant, real failures propagate so callers can surface the actual cause
   * (e.g. a stale AccessibilityNodeInfo) instead of a generic "not connected".
   */
  private fun <T> runOnMain(timeoutMs: Long = 5000, callable: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return callable()
    }
    val future = CompletableFuture<T>()
    mainHandler.post {
      try {
        future.complete(callable())
      } catch (t: Throwable) {
        future.completeExceptionally(t)
      }
    }
    return try {
      future.get(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (e: TimeoutException) {
      throw MainThreadFailure(TimeoutException("Timed out on the main thread"))
    } catch (e: java.util.concurrent.ExecutionException) {
      throw MainThreadFailure(e.cause)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      throw MainThreadFailure(e)
    }
  }
}
