package expo.modules.processtext

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProcessTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ProcessText")

    AsyncFunction("consumePendingText") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ProcessTextStore.consume(context)
    }
  }
}
