import { bridge as desktopBridge } from "./bridge";

/**
 * Renderer-side implementation of the deprecated `expo-file-system/legacy`
 * module.
 *
 * Only one function is used by the app: `getContentUriAsync`, which produces a
 * `content://` URI for Android's share sheet. On desktop a plain `file://` URI
 * is the correct equivalent, and the main process owns that conversion.
 */

function bridge() {
  return desktopBridge("The legacy filesystem API");
}

export async function getContentUriAsync(
  uriOrFile: string,
): Promise<string> {
  return bridge().fsSync.contentUri(uriOrFile);
}

export async function getInfoAsync(uriOrFile: string) {
  const stat = bridge().fsSync.stat(uriOrFile);

  return {
    exists: stat.exists,
    isDirectory: stat.exists ? stat.type === "directory" : null,
    uri: stat.path,
    size: stat.exists ? stat.size : null,
    modificationTime: stat.lastModified,
    creationTime: stat.creationTime,
  };
}

export async function readAsStringAsync(uriOrFile: string): Promise<string> {
  return bridge().fsSync.readTextFile(uriOrFile);
}

export async function writeAsStringAsync(
  uriOrFile: string,
  contents: string,
): Promise<void> {
  bridge().fsSync.writeFile(uriOrFile, contents);
}

export async function deleteAsync(
  uriOrFile: string,
  options?: { idempotent?: boolean },
): Promise<void> {
  bridge().fsSync.deleteEntry(uriOrFile);
}

export async function makeDirectoryAsync(
  uriOrFile: string,
  options?: { intermediates?: boolean },
): Promise<void> {
  bridge().fsSync.createDirectory(uriOrFile, options);
}

export async function readDirectoryAsync(uriOrFile: string): Promise<string[]> {
  return bridge()
    .fsSync.list(uriOrFile)
    .map((entry) => entry.path);
}

export async function copyAsync(options: {
  from: string;
  to: string;
}): Promise<void> {
  bridge().fsSync.copyEntry(options.from, options.to);
}

export async function moveAsync(options: {
  from: string;
  to: string;
}): Promise<void> {
  bridge().fsSync.moveEntry(options.from, options.to);
}
