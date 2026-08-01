package expo.modules.processtext

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class ProcessTextActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val selectedText = intent
      .getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
      ?.toString()
      ?.trim()

    if (!selectedText.isNullOrEmpty()) {
      ProcessTextStore.save(this, selectedText)
      startActivity(
        Intent(
          Intent.ACTION_VIEW,
          Uri.parse("mobile-agent:///settings/prompts?capture=1"),
        ).apply {
          setPackage(packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        },
      )
    }

    setResult(RESULT_CANCELED)
    finish()
  }
}
