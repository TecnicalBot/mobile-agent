import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceCatalogModel } from "../catalog";
import {
  cancelPersistentVoiceDownload,
  getPersistentVoiceDownloadStatus,
  prepareVoiceDownloadNotifications,
  startPersistentVoiceDownload,
  supportsPersistentVoiceDownloads,
} from "../persistent-download";

const native = vi.hoisted(() => ({
  cancel: vi.fn(async () => {}),
  prepare: vi.fn(async () => true),
  start: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/modules/on-device/model-download", () => ({
  cancelPersistentFileDownload: native.cancel,
  getPersistentFileDownloadStatus: native.status,
  isPersistentModelDownloadActive: (status: { state: string }) =>
    status.state === "queued" || status.state === "downloading",
  preparePersistentModelDownloadNotifications: native.prepare,
  startPersistentFileDownload: native.start,
  supportsPersistentFileDownloads: () => true,
}));

vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///document" },
  Directory: class {
    create() {}
  },
  File: class {},
}));
vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: () => ({
    cancelAsync: async () => {},
    downloadAsync: async () => undefined,
  }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const model: VoiceCatalogModel = {
  description: "Fastest • multilingual",
  id: "tiny",
  label: "Whisper Tiny",
  sizeBytes: 77_691_713,
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
};

const relativePath = "mobile-agent/voice/ggml-tiny.bin";

describe("persistent voice downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the generic native downloader", () => {
    expect(supportsPersistentVoiceDownloads()).toBe(true);
  });

  it("starts at the same location the JS downloader reads from", async () => {
    native.start.mockResolvedValue({ progress: 0, state: "queued" });

    await startPersistentVoiceDownload(model);

    expect(native.start).toHaveBeenCalledWith({
      expectedBytes: model.sizeBytes,
      id: "voice-tiny",
      label: "Whisper Tiny",
      relativePath,
      url: model.url,
    });
  });

  it("reads status with the model size and path", async () => {
    native.status.mockResolvedValue({ progress: 0.5, state: "downloading" });

    await getPersistentVoiceDownloadStatus(model);

    expect(native.status).toHaveBeenCalledWith(
      "voice-tiny",
      model.sizeBytes,
      relativePath,
      undefined,
    );
  });

  it("can poll the exact WorkManager request instead of its history", async () => {
    native.status.mockResolvedValue({ progress: 0.5, state: "downloading" });

    await getPersistentVoiceDownloadStatus(model, "work-123");

    expect(native.status).toHaveBeenCalledWith(
      "voice-tiny",
      model.sizeBytes,
      relativePath,
      "work-123",
    );
  });

  it("reuses the shared notification permission flow", async () => {
    await prepareVoiceDownloadNotifications();
    expect(native.prepare).toHaveBeenCalledOnce();
  });

  it("cancels through the shared WorkManager work name", async () => {
    await cancelPersistentVoiceDownload("tiny");
    expect(native.cancel).toHaveBeenCalledWith("voice-tiny");
  });
});
