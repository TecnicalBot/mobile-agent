/**
 * Renderer-side no-op for `expo-splash-screen`.
 *
 * `_layout.tsx` calls `SplashScreen.preventAutoHideAsync()` at module scope, so
 * the module must exist for the web bundle to load. Electron draws its own
 * window, and `BrowserWindow` is configured with `show: false` plus a
 * `ready-to-show` reveal, which covers the same need.
 */

export async function preventAutoHideAsync(): Promise<void> {}

export async function hideAsync(): Promise<void> {}

export function hide(): void {}

export function setOptions(): void {}

export async function setAutoHideAsync(): Promise<void> {}
