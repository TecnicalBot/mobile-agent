package expo.modules.quoteselection

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.EditText
import android.widget.TextView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Adds a "Quote (Ask)" item to the native text-selection menu on Android.
 *
 * React Native's `<Text selectable>` renders an Android `ReactTextView`, which
 * exposes no selection range to JS. This module watches the activity view tree,
 * attaches a `customSelectionActionModeCallback` to every selectable `TextView`
 * (skipping `EditText` inputs), and emits `onQuoteSelected` with the highlighted
 * text when the user taps the injected item.
 *
 * The platform adds Cut/Copy/Paste/Select-all *before* invoking the custom
 * callback (`Editor.SelectionActionModeCallback#onCreateActionMode` calls
 * `populateMenuWithItems` first), so the built-in Copy item is preserved.
 */
class QuoteSelectionModule : Module() {
  private var registered = false
  private var watchedActivity: WeakReference<Activity>? = null

  override fun definition() = ModuleDefinition {
    Name("QuoteSelection")

    Events("onQuoteSelected")

    AsyncFunction("start") {
      startWatching()
    }
  }

  private fun startWatching() {
    if (registered) return
    val context = appContext.reactContext ?: return
    val application = context.applicationContext as? Application ?: return
    registered = true

    application.registerActivityLifecycleCallbacks(object :
      Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityResumed(activity: Activity) {
        // Lifecycle callbacks are delivered on the main thread.
        attachToActivity(activity)
      }

      override fun onActivityPaused(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {
        if (watchedActivity?.get() === activity) {
          watchedActivity = null
        }
      }
    })

    // `start()` is an async module function, so it may run off the UI thread;
    // view access must hop to the UI thread.
    appContext.currentActivity?.let { activity ->
      activity.runOnUiThread { attachToActivity(activity) }
    }
  }

  private fun attachToActivity(activity: Activity) {
    if (watchedActivity?.get() === activity) return
    val decorView = activity.window?.decorView ?: return
    watchedActivity = WeakReference(activity)
    decorView.viewTreeObserver.addOnGlobalLayoutListener(
      ViewTreeObserver.OnGlobalLayoutListener { scan(decorView) },
    )
    scan(decorView)
  }

  private fun scan(view: View) {
    if (view is TextView) {
      attachSelectionCallback(view)
      return
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        scan(view.getChildAt(index))
      }
    }
  }

  private fun attachSelectionCallback(textView: TextView) {
    if (textView is EditText) return
    if (!textView.isTextSelectable) return
    if (textView.getTag(QUOTE_TAG_KEY) == true) return

    textView.setTag(QUOTE_TAG_KEY, true)
    textView.customSelectionActionModeCallback = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean = true

      override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
        if (menu.findItem(QUOTE_ITEM_ID) == null) {
          menu.add(Menu.NONE, QUOTE_ITEM_ID, menu.size(), QUOTE_MENU_TITLE)
            .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        }
        return true
      }

      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        if (item.itemId != QUOTE_ITEM_ID) return false
        val start = textView.selectionStart
        val end = textView.selectionEnd
        if (start >= 0 && end > start) {
          val selected = textView.text.subSequence(start, end).toString()
          if (selected.isNotBlank()) {
            sendEvent("onQuoteSelected", mapOf("text" to selected))
          }
        }
        mode.finish()
        return true
      }

      override fun onDestroyActionMode(mode: ActionMode) {}
    }
  }

  private companion object {
    private const val QUOTE_MENU_TITLE = "Quote (Ask)"

    // Chosen to avoid clashing with the platform's android.R.id.* menu item ids.
    private const val QUOTE_ITEM_ID = 0x00F00001

    private val QUOTE_TAG_KEY = View.generateViewId()
  }
}
