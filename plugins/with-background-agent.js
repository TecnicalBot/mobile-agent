const { withAndroidManifest } = require('expo/config-plugins')

const SERVICE = 'expo.modules.backgroundagentservice.BackgroundAgentService'
const RECEIVER =
  'expo.modules.backgroundagentservice.BackgroundAgentActionReceiver'

function addPermissionsAndService(androidManifest) {
  // All of these are normal permissions: no runtime prompt, no special access.
  const permissionsToAdd = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.CHANGE_WIFI_STATE',
    'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  ]

  const existingPermissions =
    androidManifest.manifest['uses-permission'] || []
  const existingNames = new Set(
    existingPermissions.map((p) => p['$']['android:name']),
  )

  for (const permission of permissionsToAdd) {
    if (!existingNames.has(permission)) {
      existingPermissions.push({
        $: { 'android:name': permission },
      })
    }
  }

  androidManifest.manifest['uses-permission'] = existingPermissions

  const appEntry = androidManifest.manifest.application?.[0]
  if (appEntry) {
    const services = appEntry['service'] || []
    const existing = services.find((s) => s.$['android:name'] === SERVICE)
    if (existing) {
      // connectedDevice is the correct type for serving a paired device and,
      // unlike dataSync, has no six-hour daily timeout.
      existing.$['android:foregroundServiceType'] = 'connectedDevice'
    } else {
      services.push({
        $: {
          'android:name': SERVICE,
          'android:foregroundServiceType': 'connectedDevice',
          'android:exported': 'false',
        },
      })
    }
    appEntry['service'] = services

    const receivers = appEntry['receiver'] || []
    if (!receivers.some((r) => r.$['android:name'] === RECEIVER)) {
      receivers.push({
        $: {
          'android:name': RECEIVER,
          'android:exported': 'false',
        },
      })
    }
    appEntry['receiver'] = receivers
  }

  return androidManifest
}

module.exports = function withBackgroundAgent(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = addPermissionsAndService(config.modResults)
    return config
  })
}

module.exports.addPermissionsAndService = addPermissionsAndService
