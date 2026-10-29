package expo.modules.backgroundagentservice

/**
 * Holds the JS listener while the module is alive. The broadcast receiver runs
 * outside any React context, so it needs a static hand-off.
 */
object BackgroundAgentApproval {
  @Volatile
  private var listener: ((Boolean) -> Unit)? = null

  fun setListener(value: ((Boolean) -> Unit)?) {
    listener = value
  }

  fun deliver(accepted: Boolean) {
    val current = listener ?: return
    BackgroundAgentService.setWaitingForApproval(false)
    current(accepted)
  }
}
