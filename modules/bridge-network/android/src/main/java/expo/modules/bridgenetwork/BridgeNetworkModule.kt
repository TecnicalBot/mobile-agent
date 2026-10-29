package expo.modules.bridgenetwork

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Enumerates local interface addresses so the phone can advertise an address a
 * harness can actually reach. No permission is required to read them.
 */
class BridgeNetworkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BridgeNetwork")

    AsyncFunction("listInterfaces") {
      val result = mutableListOf<Map<String, String>>()
      try {
        for (networkInterface in NetworkInterface.getNetworkInterfaces()) {
          if (!networkInterface.isUp) continue
          for (address in networkInterface.inetAddresses) {
            val host = address.hostAddress?.substringBefore("%") ?: continue
            result.add(
              mapOf(
                "name" to networkInterface.name,
                "address" to host,
                "family" to if (address is Inet4Address) "ipv4" else "ipv6",
              ),
            )
          }
        }
      } catch (_: Exception) {
        // Interface enumeration is best effort; the UI falls back to manual entry.
      }
      result
    }
  }
}
