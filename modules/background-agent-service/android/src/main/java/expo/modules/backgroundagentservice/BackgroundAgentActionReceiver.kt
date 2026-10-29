package expo.modules.backgroundagentservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Receives Allow/Deny from the approval notification without opening the app. */
class BackgroundAgentActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context?, intent: Intent?) {
    val accepted = when (intent?.action) {
      BackgroundAgentService.ACTION_ALLOW -> true
      BackgroundAgentService.ACTION_DENY -> false
      else -> return
    }
    BackgroundAgentApproval.deliver(accepted)
  }
}
