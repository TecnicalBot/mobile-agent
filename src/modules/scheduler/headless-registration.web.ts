/**
 * Web no-op for the headless scheduler task registration.
 *
 * `index.js` imports `headless-registration` as its side effect, which on native
 * registers a `HeadlessTask` with `AppRegistry` so the OS can wake the app for a
 * scheduled run. That is a native-only capability, and the module it pulls in
 * (`headless.ts`) opens a second `expo-sqlite` connection, so keeping it in the
 * graph would drag the unusable browser SQLite build into the bundle.
 *
 * Metro resolves this `.web.ts` variant ahead of `headless-registration.ts` for
 * the web platform, so the Android entry point is unaffected.
 */
export const SCHEDULER_WAKE_TASK_KEY = "SchedulerWakeTask";
