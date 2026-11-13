import {
  cancelPersistentFileDownload,
  getPersistentFileDownloadStatus,
  isPersistentModelDownloadActive,
  preparePersistentModelDownloadNotifications,
  startPersistentFileDownload,
  supportsPersistentFileDownloads,
  type PersistentModelDownloadStatus,
} from "@/modules/on-device/model-download";

import type { VoiceCatalogModel } from "./catalog";
import { voiceModelRelativePath } from "./models";

export type { PersistentModelDownloadStatus };
export { isPersistentModelDownloadActive };

export function supportsPersistentVoiceDownloads() {
  return supportsPersistentFileDownloads();
}

/**
 * Namespaces the WorkManager work and notification id so a voice model can
 * never collide with an on-device LiteRT model that happens to share an id.
 */
function downloadId(id: string) {
  return `voice-${id}`;
}

/** Android background downloads use the shared notification channel. */
export function prepareVoiceDownloadNotifications() {
  return preparePersistentModelDownloadNotifications();
}

export async function startPersistentVoiceDownload(model: VoiceCatalogModel) {
  return startPersistentFileDownload({
    expectedBytes: model.sizeBytes,
    id: downloadId(model.id),
    label: model.label,
    relativePath: voiceModelRelativePath(model.id),
    url: model.url,
  });
}

export function getPersistentVoiceDownloadStatus(
  model: VoiceCatalogModel,
  workId?: string | null,
) {
  return getPersistentFileDownloadStatus(
    downloadId(model.id),
    model.sizeBytes,
    voiceModelRelativePath(model.id),
    workId,
  );
}

export function cancelPersistentVoiceDownload(id: string) {
  return cancelPersistentFileDownload(downloadId(id));
}
