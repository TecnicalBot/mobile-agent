package expo.modules.deviceautomation

/**
 * Process-wide source of truth for the user's "do not touch" blocklist.
 *
 * The list is pushed from JS via [DeviceAutomationModule.setProtectedApps]
 * whenever settings are hydrated or changed, and is read by both the
 * accessibility service and the module so every automation path refuses to
 * perceive or control protected apps. Both components run in the same process,
 * so a volatile field is enough.
 */
object ProtectedApps {
  @Volatile
  var packages: Set<String> = emptySet()

  fun isProtected(packageName: String?): Boolean {
    if (packageName.isNullOrBlank()) return false
    return packageName in packages
  }
}
