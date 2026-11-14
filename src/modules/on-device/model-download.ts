import { requireOptionalNativeModule } from "expo";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { fetchOnDeviceModelCatalogCached } from "@/modules/on-device/catalog";

export type PersistentModelDownloadState =
  "idle" | "queued" | "downloading" | "succeeded" | "failed" | "cancelled";

export type PersistentModelDownloadStatus = {
  bytesDownloaded: number;
  error: string | null;
  progress: number;
  state: PersistentModelDownloadState;
  totalBytes: number;
  /** WorkManager request id, used to poll this attempt instead of history. */
  workId?: string | null;
};

type PersistentModelDownloadNativeModule = {
  cancelDownload(modelId: string): Promise<void>;
  getDownloadStatus(
    modelId: string,
    expectedBytes: number,
  ): Promise<PersistentModelDownloadStatus>;
  getFileDownloadStatus(
    modelId: string,
    expectedBytes: number,
    relativePath: string,
  ): Promise<PersistentModelDownloadStatus>;
  getFileDownloadStatusById(
    workId: string,
    expectedBytes: number,
    relativePath: string,
  ): Promise<PersistentModelDownloadStatus>;
  prepareNotifications(): Promise<void>;
  startDownload(
    modelId: string,
    url: string,
    sha256: string,
    expectedBytes: number,
    label: string,
  ): Promise<PersistentModelDownloadStatus>;
  startFileDownload(
    modelId: string,
    url: string,
    sha256: string,
    expectedBytes: number,
    label: string,
    relativePath: string,
  ): Promise<PersistentModelDownloadStatus>;
};

const nativeModule =
  requireOptionalNativeModule<PersistentModelDownloadNativeModule>(
    "PersistentModelDownload",
  );

function requireAndroidModule() {
  if (Platform.OS !== "android") {
    throw new Error("Persistent model downloads are Android-only.");
  }
  if (!nativeModule) {
    throw new Error(
      "Persistent model downloads require a new Android development build.",
    );
  }
  return nativeModule;
}

async function requireModel(modelId: string) {
  await fetchOnDeviceModelCatalogCached();
  const { getRegistryEntry } = await import("expo-ai-kit");
  const model = getRegistryEntry(modelId);
  if (!model) {
    throw new Error(`Unknown on-device model: ${modelId}`);
  }
  return model;
}

export function isPersistentModelDownloadActive(
  status: PersistentModelDownloadStatus,
) {
  return status.state === "queued" || status.state === "downloading";
}

export async function preparePersistentModelDownloadNotifications() {
  const module = requireAndroidModule();
  await module.prepareNotifications();

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function startPersistentModelDownload(
  modelId: string,
  label: string,
) {
  const module = requireAndroidModule();
  const model = await requireModel(modelId);

  return module.startDownload(
    modelId,
    model.downloadUrl,
    model.sha256,
    model.sizeBytes,
    label,
  );
}

export async function getPersistentModelDownloadStatus(modelId: string) {
  const module = requireAndroidModule();
  const model = await requireModel(modelId);
  return module.getDownloadStatus(modelId, model.sizeBytes);
}

/**
 * Deletes downloaded on-device model files whose size no longer matches the
 * catalog.
 *
 * The LiteRT-LM runtime treats "downloaded" as "the file exists", so a model
 * that upstream (or we) repointed to a new file keeps loading the old weights
 * after the catalog changes. Reconciling by size makes the catalog update
 * self-healing instead of requiring users to delete and re-download by hand.
 */
export async function removeStaleOnDeviceModelFiles(
  models: { id: string; sizeBytes: number }[],
) {
  if (Platform.OS !== "android" || !nativeModule) {
    return [] as string[];
  }

  const { deleteModel, getDownloadableModels } = await import("expo-ai-kit");
  const catalogById = new Map(models.map((model) => [model.id, model]));
  const staleIds: string[] = [];

  for (const model of await getDownloadableModels()) {
    if (
      model.status !== "downloaded" &&
      model.status !== "ready" &&
      model.status !== "loading"
    ) {
      continue;
    }
    const entry = catalogById.get(model.id);
    if (!entry) continue;

    try {
      const status = await nativeModule.getDownloadStatus(
        model.id,
        entry.sizeBytes,
      );
      if (
        status.state !== "succeeded" ||
        status.bytesDownloaded !== entry.sizeBytes
      ) {
        staleIds.push(model.id);
      }
    } catch {
      // Older builds without the persistent download module; nothing to do.
    }
  }

  for (const modelId of staleIds) {
    try {
      await deleteModel(modelId);
    } catch {
      // Leave the file in place if it cannot be removed; the next download
      // attempt replaces it by size.
    }
  }

  return staleIds;
}

export async function cancelPersistentModelDownload(modelId: string) {
  await requireAndroidModule().cancelDownload(modelId);
}

/**
 * True when the installed native build exposes the generic file-download API.
 * Older builds only have the on-device `.litertlm` entry points, so callers
 * must fall back instead of failing an over-the-air JS update.
 */
export function supportsPersistentFileDownloads() {
  return (
    Platform.OS === "android" &&
    nativeModule !== null &&
    typeof nativeModule.startFileDownload === "function" &&
    typeof nativeModule.getFileDownloadStatus === "function"
  );
}

export type PersistentFileDownloadRequest = {
  expectedBytes: number;
  id: string;
  label: string;
  /** Path relative to the app's files directory. */
  relativePath: string;
  /** Optional SHA-256; when absent the download is validated by size only. */
  sha256?: string;
  url: string;
};

function requireFileDownloadModule() {
  if (!supportsPersistentFileDownloads()) {
    throw new Error(
      "Persistent file downloads require a new Android development build.",
    );
  }
  return nativeModule as PersistentModelDownloadNativeModule;
}

export async function startPersistentFileDownload(
  request: PersistentFileDownloadRequest,
) {
  const module = requireFileDownloadModule();
  return module.startFileDownload(
    request.id,
    request.url,
    request.sha256 ?? "",
    request.expectedBytes,
    request.label,
    request.relativePath,
  );
}

export async function getPersistentFileDownloadStatus(
  id: string,
  expectedBytes: number,
  relativePath: string,
  workId?: string | null,
) {
  const module = requireFileDownloadModule();
  // Older dev builds only expose the by-name query. Keep working after an
  // over-the-air JS update; new builds poll the exact request instead.
  if (workId && typeof module.getFileDownloadStatusById === "function") {
    return module.getFileDownloadStatusById(
      workId,
      expectedBytes,
      relativePath,
    );
  }
  return module.getFileDownloadStatus(id, expectedBytes, relativePath);
}

export async function cancelPersistentFileDownload(id: string) {
  await requireAndroidModule().cancelDownload(id);
}
