import type { DesktopBridge } from "../../shared/contract";

/**
 * Access to the `window.desktop` bridge from a renderer shim.
 *
 * Every shim needs the same "read `window.desktop`, or explain that this is not
 * running inside the desktop app" logic, so it lives here rather than being
 * copied into each module. The `Window` augmentation is likewise declared once;
 * TypeScript merges it into the global scope for every file that imports this.
 */

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/**
 * Returns the bridge, or throws with `what` naming the feature that is missing.
 *
 * The message matters: a shim is reached from ordinary app code with no hint
 * that a different module is involved, so a bare `undefined is not a function`
 * would send the reader hunting through the wrong file entirely.
 */
export function bridge(what: string): DesktopBridge {
  const api = typeof window === "undefined" ? undefined : window.desktop;

  if (!api) {
    throw new Error(
      `${what} is unavailable: the Mobile Agent desktop bridge is not present. ` +
        "This build only runs inside the desktop app.",
    );
  }

  return api;
}

/** Whether the bridge exists, for capability checks that degrade gracefully. */
export function hasBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktop);
}
