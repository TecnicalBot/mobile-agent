package expo.modules.deviceautomation

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * AccessibilityService that gives the agent the ability to perceive the
 * current screen (serialized UI tree) and drive it (taps, swipes, typing,
 * global actions) using native OS APIs. This is the foundation of device
 * automation: it works on any app, requires no root and no ADB.
 *
 * All node access happens on the main thread through [runOnMain] because
 * [AccessibilityNodeInfo] is not thread-safe.
 */
class DeviceAutomationAccessibilityService : AccessibilityService() {
  companion object {
    private const val TAG = "DeviceAutomationAccessibility"
    private var instance: DeviceAutomationAccessibilityService? = null

    const val MAX_NODES = 250
    const val MAX_DEPTH = 24

    fun getInstance(): DeviceAutomationAccessibilityService? = instance

    fun isConnected(): Boolean = instance != null
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  // -------------------------------------------------------------------------
  // Perception
  // -------------------------------------------------------------------------

  /** Serialize the current window's UI tree into a compact, LLM-friendly list of nodes. */
  fun getUiTree(): Map<String, Any?> = runOnMain {
    val root = rootInActiveWindow
    if (root == null) {
      return@runOnMain mapOf(
        "success" to false,
        "error" to "No active window available. Is the accessibility service enabled and the screen unlocked?",
      )
    }

    val nodes = mutableListOf<AccessibilityNodeInfo>()
    collectNodes(root, 0, nodes)

    val serialized = nodes.mapIndexed { index, node -> serializeNode(node, index) }
    val (screenWidth, screenHeight) = screenSize()
    mapOf(
      "success" to true,
      "nodeCount" to serialized.size,
      "nodes" to serialized,
      "truncated" to (nodes.size >= MAX_NODES),
      "screenWidth" to screenWidth,
      "screenHeight" to screenHeight,
    )
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  /** Depth-first, filtered traversal that yields the nodes exposed to the model. */
  private fun collectNodes(
    node: AccessibilityNodeInfo,
    depth: Int,
    out: MutableList<AccessibilityNodeInfo>,
  ) {
    if (out.size >= MAX_NODES) return
    if (depth > MAX_DEPTH) return
    if (!node.isVisibleToUser) return

    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    if (bounds.width() <= 0 || bounds.height() <= 0) return

    val actionable = node.isClickable || node.isScrollable || node.isEditable || node.isCheckable
    val hasLabel =
      !getNodeText(node).isNullOrBlank() || !node.contentDescription.isNullOrBlank()

    // Include labeled or actionable nodes, and leaf nodes (which may matter even
    // when unlabeled). Skip pure container nodes to keep the tree small.
    if (hasLabel || actionable || node.childCount == 0) {
      out.add(node)
    }

    for (i in 0 until node.childCount) {
      val child = try {
        node.getChild(i)
      } catch (_: Exception) {
        null
      } ?: continue
      collectNodes(child, depth + 1, out)
    }
  }

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
  // Action primitives
  // -------------------------------------------------------------------------

  fun tapAt(x: Int, y: Int): Map<String, Any?> = runOnMain {
    val (cx, cy) = clampToScreen(x, y)
    val gesture = GestureDescription.Builder()
      .addStroke(
        GestureDescription.StrokeDescription(
          Path().apply { moveTo(cx.toFloat(), cy.toFloat()) },
          0,
          80,
        ),
      )
      .build()
    gestureResult("tap", dispatchGesture(gesture))
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun tapNode(index: Int): Map<String, Any?> = runOnMain {
    val node = collectNodes().getOrNull(index)
    if (node == null) {
      return@runOnMain mapOf("success" to false, "error" to "No node with index $index. Re-read the screen.")
    }
    val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    mapOf("success" to clicked, "index" to index)
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun typeText(text: String): Map<String, Any?> = runOnMain {
    val nodes = collectNodes()
    val target = nodes.firstOrNull { it.isFocused && it.isEditable }
      ?: nodes.firstOrNull { it.isEditable }

    if (target == null) {
      return@runOnMain mapOf(
        "success" to false,
        "error" to "No editable text field found. Tap a text field first.",
      )
    }

    // Ensure the field is focused so the text lands where the user expects.
    if (!target.isFocused) {
      target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
    }

    val setText = target.performAction(
      AccessibilityNodeInfo.ACTION_SET_TEXT,
      Bundle().apply {
        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
      },
    )

    mapOf(
      "success" to setText,
      "error" to if (setText) null else "The app rejected programmatic text input.",
    )
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun swipe(
    x1: Int,
    y1: Int,
    x2: Int,
    y2: Int,
    durationMs: Int,
  ): Map<String, Any?> = runOnMain {
    swipeGesture(x1, y1, x2, y2, durationMs)
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun longPress(x: Int, y: Int, durationMs: Int): Map<String, Any?> = runOnMain {
    val (cx, cy) = clampToScreen(x, y)
    val gesture = GestureDescription.Builder()
      .addStroke(
        GestureDescription.StrokeDescription(
          Path().apply { moveTo(cx.toFloat(), cy.toFloat()) },
          0,
          durationMs.coerceAtLeast(200).toLong(),
        ),
      )
      .build()
    gestureResult("longPress", dispatchGesture(gesture))
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun longPressNode(index: Int, durationMs: Int): Map<String, Any?> = runOnMain {
    val node = collectNodes().getOrNull(index)
    if (node == null) {
      return@runOnMain mapOf("success" to false, "error" to "No node with index $index. Re-read the screen.")
    }
    val (cx, cy) = nodeCenter(node)
    longPress(cx, cy, durationMs)
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  /** Press-and-drag from one point to another (slow swipe), for pick-and-place interactions. */
  fun drag(
    x1: Int,
    y1: Int,
    x2: Int,
    y2: Int,
    durationMs: Int,
  ): Map<String, Any?> = runOnMain {
    swipeGesture(x1, y1, x2, y2, durationMs.coerceAtLeast(400))
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun scroll(direction: String): Map<String, Any?> = runOnMain {
    val target = collectNodes().firstOrNull { it.isScrollable }
    if (target == null) {
      return@runOnMain mapOf("success" to false, "error" to "No scrollable area found.")
    }

    // Prefer the semantic scroll action; fall back to a gesture inside the
    // scrollable node's bounds when the app doesn't implement it.
    val bounds = Rect()
    target.getBoundsInScreen(bounds)
    val centerX = bounds.left + bounds.width() / 2
    val fromY = bounds.top + bounds.height() * 4 / 5
    val toY = bounds.top + bounds.height() / 5

    val gesture = when (direction) {
      "up" -> {
        val scrolled = target.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
        if (scrolled) null else swipeGesture(centerX, fromY, centerX, toY, 250)
      }
      "down" -> {
        val scrolled = target.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        if (scrolled) null else swipeGesture(centerX, toY, centerX, fromY, 250)
      }
      "left" -> swipeGesture(
        bounds.left + bounds.width() * 4 / 5,
        bounds.top + bounds.height() / 2,
        bounds.left + bounds.width() / 5,
        bounds.top + bounds.height() / 2,
        250,
      )
      "right" -> swipeGesture(
        bounds.left + bounds.width() / 5,
        bounds.top + bounds.height() / 2,
        bounds.left + bounds.width() * 4 / 5,
        bounds.top + bounds.height() / 2,
        250,
      )
      else -> return@runOnMain mapOf("success" to false, "error" to "Unknown direction: $direction")
    }

    if (gesture == null) {
      mapOf("success" to true)
    } else {
      if (gesture["success"] == true) {
        mapOf("success" to true, "via" to "gesture")
      } else {
        mapOf("success" to false, "error" to "Scroll failed: neither the semantic action nor a swipe gesture worked.")
      }
    }
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  fun performGlobalAction(name: String): Map<String, Any?> = runOnMain {
    val action = when (name) {
      "back" -> AccessibilityService.GLOBAL_ACTION_BACK
      "home" -> AccessibilityService.GLOBAL_ACTION_HOME
      "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
      "notifications" -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings" -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
      "power_dialog" -> AccessibilityService.GLOBAL_ACTION_POWER_DIALOG
      else -> return@runOnMain mapOf("success" to false, "error" to "Unknown global action: $name")
    }
    mapOf("success" to performGlobalAction(action))
  } ?: mapOf("success" to false, "error" to "Accessibility service is not connected.")

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private fun collectNodes(): List<AccessibilityNodeInfo> {
    val root = rootInActiveWindow ?: return emptyList()
    val nodes = mutableListOf<AccessibilityNodeInfo>()
    collectNodes(root, 0, nodes)
    return nodes
  }

  private fun swipeGesture(
    x1: Int,
    y1: Int,
    x2: Int,
    y2: Int,
    durationMs: Int,
  ): Map<String, Any?> {
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
          durationMs.coerceAtLeast(100).toLong(),
        ),
      )
      .build()
    return gestureResult("swipe", dispatchGesture(gesture))
  }

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

  private fun clampToScreen(x: Int, y: Int): Pair<Int, Int> {
    val metrics = resources.displayMetrics
    return x.coerceIn(0, (metrics.widthPixels - 1).coerceAtLeast(0)) to
      y.coerceIn(0, (metrics.heightPixels - 1).coerceAtLeast(0))
  }

  private fun gestureResult(action: String, dispatched: Boolean): Map<String, Any?> {
    return if (dispatched) {
      mapOf("success" to true)
    } else {
      mapOf("success" to false, "error" to "$action gesture was rejected by the system.")
    }
  }

  private fun dispatchGesture(gesture: GestureDescription): Boolean {
    return try {
      dispatchGesture(gesture, null, null)
    } catch (e: Exception) {
      Log.e(TAG, "dispatchGesture failed", e)
      false
    }
  }

  /** Run [callable] on the main thread and await the result, with a safety timeout. */
  private fun <T> runOnMain(timeoutMs: Long = 4000, callable: () -> T): T? {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return try {
        callable()
      } catch (_: Exception) {
        null
      }
    }
    val future = CompletableFuture<T>()
    mainHandler.post {
      try {
        future.complete(callable())
      } catch (_: Exception) {
        future.completeExceptionally(IllegalStateException("Main thread call failed"))
      }
    }
    return try {
      future.get(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (_: Exception) {
      null
    }
  }
}
