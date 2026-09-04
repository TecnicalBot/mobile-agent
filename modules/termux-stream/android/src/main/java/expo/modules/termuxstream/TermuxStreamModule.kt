package expo.modules.termuxstream

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetSocketAddress
import java.net.Socket

class TermuxStreamModule : Module() {
  private var client: SseClient? = null

  override fun definition() = ModuleDefinition {
    Name("TermuxStream")

    Events("onOutput", "onDone", "onError", "onConnectionChange")

    AsyncFunction("connect") { host: String, port: Int, token: String ->
      client?.disconnect()
      val c = SseClient(host, port, token,
        onOutput = { data -> sendEvent("onOutput", mapOf("data" to data)) },
        onDone = { exitCode, state -> sendEvent("onDone", mapOf("exit_code" to exitCode, "state" to state)) },
        onError = { message -> sendEvent("onError", mapOf("message" to message)) },
        onConnectionChange = { connected -> sendEvent("onConnectionChange", mapOf("connected" to connected)) },
      )
      client = c
      reachable(host, port)
    }

    AsyncFunction("disconnect") {
      client?.disconnect()
      client = null
    }

    AsyncFunction("startStream") { taskId: String ->
      client?.start(taskId)
    }

    AsyncFunction("stopStream") {
      client?.disconnect()
    }

    AsyncFunction("isConnected") {
      val c = client
      if (c == null) false else c.isConnected()
    }

    AsyncFunction("isReachable") { host: String, port: Int ->
      reachable(host, port)
    }
  }

  private fun reachable(host: String, port: Int): Boolean {
    return try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(host, port), 3000)
        true
      }
    } catch (e: Exception) {
      false
    }
  }
}
