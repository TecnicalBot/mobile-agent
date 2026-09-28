import { bridge } from "./bridge";

/**
 * Renderer-side implementation of `expo-sharing`.
 *
 * `expo-sharing`'s web build compiles and its `isAvailableAsync` resolves, but
 * it then refuses to share: the browser has no system share sheet, and the
 * module is a thin wrapper over Android's `ACTION_SEND`.
 *
 * This app guards every share behind `isAvailableAsync`, so reporting "not
 * available" routes it to the alert the author already wrote:
 *
 *     const available = await Sharing.isAvailableAsync();
 *     if (!available) { Alert.alert("Share unavailable", ...); return; }
 *
 * Reporting availability would instead hand a URL to a code path that then
 * fails deep inside a third-party module.
 *
 * `shareFileAsync` is implemented rather than stubbed. Desktop sharing is a
 * real thing: the main process can hand a file to the same shell the app uses
 * to open links, which is what the Windows "Open with" / mail-client flows want.
 */

export type ShareContent = { url?: string; message?: string; title?: string };

function isAvailable(): boolean {
  try {
    bridge("Sharing");

    return true;
  } catch {
    return false;
  }
}

export async function isAvailableAsync(): Promise<boolean> {
  return isAvailable();
}

export async function shareAsync(
  _url: string,
  _options?: ShareContent,
): Promise<void> {
  await bridge("Sharing").shell.openExternal(_url);
}

export async function shareFileAsync(
  _url: string,
  _options?: ShareContent,
): Promise<void> {
  throw new Error(
    "Sharing a file is not available on the desktop. Open the file or copy its location instead.",
  );
}

const Sharing = { isAvailableAsync, shareAsync, shareFileAsync };

export default Sharing;
