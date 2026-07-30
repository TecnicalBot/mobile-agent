const { withAndroidManifest } = require('expo/config-plugins')

function addPermissionsAndService(androidManifest) {
  const permissionsToAdd = [
    'android.permission.POST_NOTIFICATIONS',
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
    const serviceName = 'expo.modules.backgroundagentservice.BackgroundAgentService'

    if (!services.some((s) => s.$['android:name'] === serviceName)) {
      services.push({
        $: {
          'android:name': serviceName,
          'android:foregroundServiceType': 'dataSync',
          'android:exported': 'false',
        },
      })
    }

    appEntry['service'] = services
  }

  return androidManifest
}

module.exports = function withBackgroundAgent(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = addPermissionsAndService(config.modResults)
    return config
  })
}
