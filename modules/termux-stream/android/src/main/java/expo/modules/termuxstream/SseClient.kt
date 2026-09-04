package expo.modules.termuxstream

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import android.util.Log

/**
 * Minimal SSE (Server-Sent Events) client for the termux-mcp /terminal/stream endpoint.
 * Runs on a background thread, parses `data:` lines, dispatches callbacks.
 */
class SseClient(
  private val host: String,
  private val port: Int,
  private val token: String,
  private val onOutput: (String) -> Unit,
  private val onDone: (exitCode: Int, state: String) -> Unit,
  private val onError: (String) -> Unit,
  private val onConnectionChange: (Boolean) -> Unit,
) {
  private val running = AtomicBoolean(false)
  private var thread: Thread? = null

  fun start(taskId: String) {
    if (running.getAndSet(true)) return
    thread = Thread {
      var connection: HttpURLConnection? = null
      try {
        val url = URL("http://$host:$port/terminal/stream?task_id=$taskId")
        connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 0 // no timeout; long-lived stream
        connection.setRequestProperty("Accept", "text/event-stream")
        connection.setRequestProperty("Cache-Control", "no-cache")
        if (token.isNotEmpty()) {
          connection.setRequestProperty("Authorization", "Bearer $token")
        }

        val code = connection.responseCode
        if (code != 200) {
          Log.e("TermuxStream", "stream $taskId returned HTTP $code")
          onError("Server returned HTTP $code")
          return@Thread
        }

        onConnectionChange(true)
        Log.d("TermuxStream", "stream connected for $taskId")

        val reader = BufferedReader(InputStreamReader(connection.inputStream, "UTF-8"))
        var sb = StringBuilder()
        var event = "message"
        while (running.get()) {
          val line = reader.readLine() ?: break
          when {
            line.isEmpty() -> {
              deliver(event, sb.toString())
              sb = StringBuilder()
              event = "message"
            }
            line.startsWith("event:") -> {
              event = line.removePrefix("event:").trim()
            }
            line.startsWith("data:") -> {
              val data = line.removePrefix("data:")
              if (sb.isNotEmpty()) sb.append('\n')
              sb.append(data.trimStart())
            }
          }
        }
      } catch (e: Exception) {
        if (running.get()) {
          onError(e.message ?: "connection error")
          Log.e("TermuxStream", "stream failed for $taskId", e)
        }
      } finally {
        connection?.disconnect()
        running.set(false)
        onConnectionChange(false)
      }
    }
    thread?.isDaemon = true
    thread?.start()
  }

  private fun deliver(event: String, data: String) {
    if (data.isEmpty()) return
    when (event) {
      // "output" carries base64-encoded terminal bytes
      "output" -> {
        Log.d("TermuxStream", "output event, encoded len=${data.length} for task stream")
        try {
          val bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT)
          Log.d("TermuxStream", "output decoded ${bytes.size} bytes")
          onOutput(String(bytes, Charsets.UTF_8))
        } catch (e: Exception) {
          Log.d("TermuxStream", "output not valid base64, treating as raw: ${data.take(80)}")
          onOutput(data) // fallback: not valid base64, treat as raw text
        }
      }
      "done" -> {
        try {
          val obj = org.json.JSONObject(data)
          val exitCode = try { obj.getInt("exit_code") } catch (e: Exception) { -1 }
          val state = obj.optString("state", "finished")
          onDone(exitCode, state)
        } catch (e: Exception) {
          onDone(-1, "finished")
        }
      }
      "error" -> {
        try {
          val obj = org.json.JSONObject(data)
          onError(obj.optString("message", data))
        } catch (e: Exception) {
          onError(data)
        }
      }
      else -> {}
    }
  }

  fun disconnect() {
    running.set(false)
  }

  fun isConnected(): Boolean = running.get()
}
