import { requireOptionalNativeModule } from "expo";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { fetchOnDeviceModelCatalogCached } from "@/lib/on-device/catalog";

export type PersistentModelDownloadState =
  "idle" | "queued" | "downloading" | "succeeded" | "failed" | "cancelled";

export type PersistentModelDownloadStatus = {
  bytesDownloaded: number;
  error: string | null;
  progress: number;
  state: PersistentModelDownloadState;
  totalBytes: number;
};

type PersistentModelDownloadNativeModule = {
  cancelDownload(modelId: string): Promise<void>;
  getDownloadStatus(
    modelId: string,
    expectedBytes: number,
  ): Promise<PersistentModelDownloadStatus>;
  prepareNotifications(): Promise<void>;
  startDownload(
    modelId: string,
    url: string,
    sha256: string,
    expectedBytes: number,
    label: string,
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

export async function cancelPersistentModelDownload(modelId: string) {
  await requireAndroidModule().cancelDownload(modelId);
}
