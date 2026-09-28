import { bridge, hasBridge } from "./bridge";

/**
 * Renderer-side implementation of `expo-intent-launcher`.
 *
 * Android uses intents to hand a target to another application. Every call site
 * in this app is `startActivityAsync("android.intent.action.VIEW", { data })`,
 * i.e. "open this URL or file somewhere else", which is exactly what the
 * operating system already does for `http:`, `mailto:` and `file:` targets.
 *
 * So rather than dropping the feature, the intent is forwarded to the main
 * process, which validates the scheme and then hands it to the OS. Release
 * notes, documentation links and workspace files all keep working.
 *
 * Any other action is not representable on the desktop and resolves without
 * doing anything, rather than throwing, because these calls sit in UI event
 * handlers where an unhandled rejection would surface as a red screen.
 */

export interface IntentLauncherResult {
  resultCode: number;
}

export interface IntentLauncherParams {
  /** The target: a URL, or a `file://` URI. */
  data?: string;
  type?: string;
  flags?: number;
  categories?: string[];
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

/** `Activity.RESULT_OK`; the only value a "we did the thing" intent returns. */
const RESULT_OK = -1;

export async function startActivityAsync(
  action: string,
  params: IntentLauncherParams = {},
): Promise<IntentLauncherResult> {
  // `android.intent.action.VIEW` is the generic "show me this" action. Anything
  // else names a specific Android component that has no desktop equivalent.
  if (action !== "android.intent.action.VIEW" || !params.data) {
    if (hasBridge()) {
      console.warn(
        `[expo-intent-launcher] ignoring "${action}": only android.intent.action.VIEW has a desktop equivalent.`,
      );
    }

    return { resultCode: RESULT_OK };
  }

  await bridge("Opening external links").shell.openExternal(params.data);

  return { resultCode: RESULT_OK };
}

export async function startActivityForResultAsync(
  action: string,
  params: IntentLauncherParams = {},
): Promise<{ resultCode: number; data: string | null }> {
  // There is no activity to send a result back from, so the launch is treated
  // as immediately completed. No call site in the app reads the result.
  const { resultCode } = await startActivityAsync(action, params);

  return { resultCode, data: null };
}

const IntentLauncher = { startActivityAsync, startActivityForResultAsync };

export default IntentLauncher;
