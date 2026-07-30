import { requireNativeModule } from 'expo'
import { Platform } from 'react-native'

type BackgroundAgentModule = {
  start(): Promise<void>
  stop(): Promise<void>
  isHeld(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<void>
  requestNotificationPermission(): Promise<void>
  hasNotificationPermission(): Promise<boolean>
}

const BackgroundAgent = Platform.OS === 'android'
  ? requireNativeModule<BackgroundAgentModule>('BackgroundAgent')
  : null

export async function startBackgroundAgent(): Promise<void> {
  if (Platform.OS !== 'android') return
  if (!BackgroundAgent) { console.error('[BackgroundAgent] module is null!'); return }
  try {
    await BackgroundAgent.requestBatteryOptimizationExemption()
    await BackgroundAgent.start()
    console.log('[BackgroundAgent] start() succeeded')
  } catch (e) {
    console.error('[BackgroundAgent] start() failed:', e)
  }
}

export async function stopBackgroundAgent(): Promise<void> {
  if (Platform.OS !== 'android') return
  if (!BackgroundAgent) { console.error('[BackgroundAgent] module is null!'); return }
  try {
    await BackgroundAgent.stop()
    console.log('[BackgroundAgent] stop() succeeded')
  } catch (e) {
    console.error('[BackgroundAgent] stop() failed:', e)
  }
}

export async function isBackgroundAgentHeld(): Promise<boolean> {
  if (Platform.OS === 'android' && BackgroundAgent) {
    try {
      return (await BackgroundAgent.isHeld()) as boolean
    } catch (e) {
      console.error('[BackgroundAgent] isHeld() failed:', e)
      return false
    }
  }
  return false
}

export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS === 'android' && BackgroundAgent) {
    await BackgroundAgent.requestBatteryOptimizationExemption()
  }
}

export function requestNotificationPermission(): void {
  if (Platform.OS === 'android' && BackgroundAgent) {
    BackgroundAgent.requestNotificationPermission()
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && BackgroundAgent) {
    return (await BackgroundAgent.hasNotificationPermission()) as boolean
  }
  return true
}
