package expo.modules.processtext

import android.content.Context

internal object ProcessTextStore {
  private const val PREFERENCES_NAME = "mobile_agent_process_text"
  private const val PENDING_TEXT_KEY = "pending_text"

  fun save(context: Context, text: String) {
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(PENDING_TEXT_KEY, text)
      .commit()
  }

  fun consume(context: Context): String? {
    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    val text = preferences.getString(PENDING_TEXT_KEY, null)
    if (text != null) {
      preferences.edit().remove(PENDING_TEXT_KEY).apply()
    }
    return text
  }
}
