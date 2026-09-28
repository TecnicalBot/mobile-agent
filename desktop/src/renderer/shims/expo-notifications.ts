/**
 * Renderer-side no-op for `expo-notifications`.
 *
 * The app calls `Notifications.setNotificationHandler` at module scope in
 * `src/app/_layout.tsx`, so the module has to exist and be callable for the web
 * bundle to even load.
 *
 * Desktop notifications are an Android-only feature here (the app notifies on
 * tool-approval prompts and scheduled runs). Rather than throw, every entry
 * point degrades to a no-op so the rest of the app behaves normally. Scheduling
 * state stays consistent because callers treat the returned identifiers as
 * opaque.
 */

type Listener = { remove: () => void };

export const AndroidImportance = {
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
} as const;

export const SchedulableTriggerInputTypes = {
  TIME_INTERVAL: "timeInterval",
  TIME_INTERVAL_WHEN_INACTIVE: "timeIntervalWhileInactive",
  DATE: "date",
  CALENDAR: "calendar",
  LOCATION: "location",
  REMINDER: "reminder",
} as const;

export const DEFAULT = {
  shouldPlaySound: false,
  shouldSetBadge: false,
  shouldShowBanner: false,
  shouldShowList: false,
} as const;

let identifier = 0;
const listeners = new Set<Listener>();

function noopSubscription(): Listener {
  return { remove: () => undefined };
}

export function setNotificationHandler(): void {}

export async function setNotificationChannelAsync(): Promise<string> {
  identifier += 1;

  return `channel-${identifier}`;
}

export async function setNotificationCategoryAsync(
  ..._args: unknown[]
): Promise<void> {}

export async function requestPermissionsAsync() {
  return { status: "denied", granted: false };
}

export async function getPermissionsAsync() {
  return { status: "denied", granted: false };
}

export async function scheduleNotificationAsync(): Promise<string> {
  identifier += 1;

  return `scheduled-${identifier}`;
}

export async function getAllScheduledNotificationsAsync(): Promise<unknown[]> {
  return [];
}

export async function getPresentedNotificationsAsync(): Promise<unknown[]> {
  return [];
}

export async function cancelScheduledNotificationAsync(): Promise<void> {}

export async function cancelAllScheduledNotificationsAsync(): Promise<void> {}

export async function dismissNotificationAsync(): Promise<boolean> {
  return false;
}

export async function dismissAllNotificationsAsync(): Promise<void> {}

export function addNotificationResponseReceivedListener(): Listener {
  const subscription = noopSubscription();

  listeners.add(subscription);

  return subscription;
}

export function addNotificationReceivedListener(): Listener {
  return noopSubscription();
}

export async function getLastNotificationResponseAsync(): Promise<null> {
  return null;
}

export async function clearLastNotificationResponseAsync(): Promise<void> {}

/** Clears the module-level listener set. Exposed for tests. */
export function __resetListeners(): void {
  listeners.clear();
}
