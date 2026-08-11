import { requireNativeModule } from 'expo'
import { Platform } from 'react-native'

type BackgroundAgentModule = {
  start(): Promise<void>
  stop(): Promise<void>
  isHeld(): Promise<boolean>
  isIgnoringBatteryOptimizations(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<void>
  openBatteryOptimizationSettings(): Promise<void>
  requestNotificationPermission(): Promise<void>
  hasNotificationPermission(): Promise<boolean>
  setNotificationState(state: 'running' | 'waiting_approval'): Promise<void>
}

const BackgroundAgent = Platform.OS === 'android'
  ? requireNativeModule<BackgroundAgentModule>('BackgroundAgent')
  : null

export async function startBackgroundAgent(): Promise<void> {
  if (Platform.OS !== 'android') return
  if (!BackgroundAgent) { console.error('[BackgroundAgent] module is null!'); return }
  try {
    await BackgroundAgent.start()
  } catch (e) {
    console.error('[BackgroundAgent] start() failed:', e)
  }
}

export async function stopBackgroundAgent(): Promise<void> {
  if (Platform.OS !== 'android') return
  if (!BackgroundAgent) { console.error('[BackgroundAgent] module is null!'); return }
  try {
    await BackgroundAgent.stop()
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

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS === 'android' && BackgroundAgent) {
    try {
      return (await BackgroundAgent.isIgnoringBatteryOptimizations()) as boolean
    } catch (e) {
      console.error('[BackgroundAgent] isIgnoringBatteryOptimizations() failed:', e)
      return false
    }
  }
  return true
}

export async function openBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS === 'android' && BackgroundAgent) {
    await BackgroundAgent.openBatteryOptimizationSettings()
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

export async function setBackgroundAgentNotificationState(
  state: 'running' | 'waiting_approval',
): Promise<void> {
  if (Platform.OS === 'android' && BackgroundAgent) {
    await BackgroundAgent.setNotificationState(state)
  }
}
