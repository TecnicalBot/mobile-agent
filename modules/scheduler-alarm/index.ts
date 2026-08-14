import { requireNativeModule } from 'expo'
import { Platform } from 'react-native'

type SchedulerAlarmModule = {
  setAlarm(triggerAtMs: number, scheduleId: string): Promise<void>
  cancelAlarm(scheduleId: string): Promise<void>
  cancelAllAlarms(): Promise<void>
  hasExactAlarmPermission(): Promise<boolean>
  openExactAlarmSettings(): Promise<void>
}

const SchedulerAlarm = Platform.OS === 'android'
  ? requireNativeModule<SchedulerAlarmModule>('SchedulerAlarm')
  : null

export async function setScheduleAlarm(
  triggerAtMs: number,
  scheduleId: string,
): Promise<void> {
  if (Platform.OS === 'android' && SchedulerAlarm) {
    await SchedulerAlarm.setAlarm(triggerAtMs, scheduleId)
  }
}

export async function cancelScheduleAlarm(scheduleId: string): Promise<void> {
  if (Platform.OS === 'android' && SchedulerAlarm) {
    await SchedulerAlarm.cancelAlarm(scheduleId)
  }
}

export async function cancelAllScheduleAlarms(): Promise<void> {
  if (Platform.OS === 'android' && SchedulerAlarm) {
    await SchedulerAlarm.cancelAllAlarms()
  }
}

export async function hasExactAlarmPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && SchedulerAlarm) {
    try {
      return (await SchedulerAlarm.hasExactAlarmPermission()) as boolean
    } catch (e) {
      console.error('[SchedulerAlarm] hasExactAlarmPermission() failed:', e)
      return false
    }
  }
  return true
}

export async function openExactAlarmSettings(): Promise<void> {
  if (Platform.OS === 'android' && SchedulerAlarm) {
    await SchedulerAlarm.openExactAlarmSettings()
  }
}
