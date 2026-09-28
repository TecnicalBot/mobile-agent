/**
 * Renderer-side implementation of `expo-media-library`.
 *
 * The only call in the app is `requestPermissionsAsync(true)` before saving a
 * generated image to the device gallery, and it already handles a denied
 * permission by showing its own explanation:
 *
 *     const permission = await MediaLibrary.requestPermissionsAsync(true);
 *     if (!permission.granted) { Alert.alert(...); return; }
 *
 * So reporting "not granted" is not a stub that silently breaks a feature, it
 * routes the existing code down the branch the author already wrote for a
 * device with no photo permission. The desktop app has no equivalent gallery,
 * so that is also the honest answer.
 */

export type MediaLibraryPermission = "granted" | "denied";

export interface MediaLibraryPermissionResponse {
  status: MediaLibraryPermission;
  granted: boolean;
  canAskAgain: boolean;
  expires: "never" | number;
  accessPrivileges: "all" | "limited";
}

// The real module exports `MediaLibraryPermission` as both a type and a value,
// and app code imports it either way, so this shim has to declare both. A type
// alias cannot merge with a value the way an interface can, which is why
// `ignoreDeclarationMerge` does not cover this.
/* eslint-disable @typescript-eslint/no-redeclare */
export const MediaLibraryPermission = {
  AUTO: "auto" as const,
  READ_WRITE: "readWrite" as const,
  LIMITED: "limited" as const,
};
/* eslint-enable @typescript-eslint/no-redeclare */

function denied(): MediaLibraryPermissionResponse {
  return {
    status: "denied",
    granted: false,
    canAskAgain: false,
    expires: "never",
    accessPrivileges: "all",
  };
}

export async function requestPermissionsAsync(
  _writeOnly?: boolean,
  _granularPermissions?: unknown,
): Promise<MediaLibraryPermissionResponse> {
  return denied();
}

export async function getPermissionsAsync(
  _writeOnly?: boolean,
): Promise<MediaLibraryPermissionResponse> {
  return denied();
}

export async function saveToLibraryAsync(_fileUri: string): Promise<void> {
  throw new Error(
    "Saving to the photo library is not available on the desktop; write the file into the workspace instead.",
  );
}

export async function createAssetAsync(_localUri: string): Promise<unknown> {
  throw new Error("The photo library is not available on the desktop.");
}

export async function deleteAssetsAsync(_ids: string[]): Promise<void> {
  throw new Error("The photo library is not available on the desktop.");
}

export async function getAssetsAsync(_options?: unknown): Promise<unknown[]> {
  return [];
}

const MediaLibrary = {
  MediaLibraryPermission,
  requestPermissionsAsync,
  getPermissionsAsync,
  saveToLibraryAsync,
  createAssetAsync,
  deleteAssetsAsync,
  getAssetsAsync,
};

export default MediaLibrary;
