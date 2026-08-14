const { withAndroidManifest } = require('expo/config-plugins')

function addPermissionsAndComponents(androidManifest) {
  const permissionsToAdd = [
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.RECEIVE_BOOT_COMPLETED',
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
    const serviceName = 'expo.modules.scheduleralarm.SchedulerWakeService'

    if (!services.some((s) => s.$['android:name'] === serviceName)) {
      services.push({
        $: {
          'android:name': serviceName,
          'android:exported': 'false',
        },
      })
    }

    appEntry['service'] = services

    const receivers = appEntry['receiver'] || []

    if (
      !receivers.some(
        (r) =>
          r.$['android:name'] ===
          'expo.modules.scheduleralarm.SchedulerAlarmReceiver',
      )
    ) {
      receivers.push({
        $: {
          'android:name':
            'expo.modules.scheduleralarm.SchedulerAlarmReceiver',
          'android:exported': 'false',
        },
      })
    }

    if (
      !receivers.some(
        (r) =>
          r.$['android:name'] ===
          'expo.modules.scheduleralarm.SchedulerAlarmBootReceiver',
      )
    ) {
      receivers.push({
        $: {
          'android:name':
            'expo.modules.scheduleralarm.SchedulerAlarmBootReceiver',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            ],
          },
        ],
      })
    }

    appEntry['receiver'] = receivers
  }

  return androidManifest
}

module.exports = function withSchedulerAlarm(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = addPermissionsAndComponents(config.modResults)
    return config
  })
}
