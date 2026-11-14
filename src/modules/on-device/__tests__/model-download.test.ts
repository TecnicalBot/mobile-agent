import { beforeEach, describe, expect, it, vi } from "vitest";

import { removeStaleOnDeviceModelFiles } from "../model-download";

const native = vi.hoisted(() => ({
  deleteModel: vi.fn(async () => {}),
  getDownloadStatus: vi.fn(),
  getDownloadableModels: vi.fn(),
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => ({
    getDownloadStatus: native.getDownloadStatus,
  }),
}));

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

vi.mock("expo-ai-kit", () => ({
  deleteModel: native.deleteModel,
  getDownloadableModels: native.getDownloadableModels,
  getRegistryEntry: vi.fn(),
}));

const catalog = [
  { id: "lfm2.5-1.2b", sizeBytes: 736_015_744 },
  { id: "qwen3-1.7b", sizeBytes: 2_056_729_520 },
];

function status(bytesDownloaded: number, state = "succeeded") {
  return {
    bytesDownloaded,
    error: null,
    progress: 1,
    state,
    totalBytes: bytesDownloaded,
  };
}

describe("removeStaleOnDeviceModelFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes downloaded files whose size no longer matches the catalog", async () => {
    native.getDownloadableModels.mockResolvedValue([
      { id: "lfm2.5-1.2b", status: "downloaded" },
      { id: "qwen3-1.7b", status: "ready" },
    ]);
    native.getDownloadStatus
      .mockResolvedValueOnce(status(736_083_968))
      .mockResolvedValueOnce(status(2_056_729_520));

    const removed = await removeStaleOnDeviceModelFiles(catalog);

    expect(removed).toEqual(["lfm2.5-1.2b"]);
    expect(native.deleteModel).toHaveBeenCalledTimes(1);
    expect(native.deleteModel).toHaveBeenCalledWith("lfm2.5-1.2b");
  });

  it("keeps files that match their catalog entry", async () => {
    native.getDownloadableModels.mockResolvedValue([
      { id: "lfm2.5-1.2b", status: "downloaded" },
    ]);
    native.getDownloadStatus.mockResolvedValue(status(736_015_744));

    await expect(removeStaleOnDeviceModelFiles(catalog)).resolves.toEqual([]);
    expect(native.deleteModel).not.toHaveBeenCalled();
  });

  it("treats a stale file the native layer reports as idle as removed", async () => {
    native.getDownloadableModels.mockResolvedValue([
      { id: "lfm2.5-1.2b", status: "downloaded" },
    ]);
    native.getDownloadStatus.mockResolvedValue(status(0, "idle"));

    await expect(removeStaleOnDeviceModelFiles(catalog)).resolves.toEqual([
      "lfm2.5-1.2b",
    ]);
    expect(native.deleteModel).toHaveBeenCalledWith("lfm2.5-1.2b");
  });

  it("ignores models that are not downloaded", async () => {
    native.getDownloadableModels.mockResolvedValue([
      { id: "lfm2.5-1.2b", status: "not-downloaded" },
    ]);

    await expect(removeStaleOnDeviceModelFiles(catalog)).resolves.toEqual([]);
    expect(native.getDownloadStatus).not.toHaveBeenCalled();
    expect(native.deleteModel).not.toHaveBeenCalled();
  });
});
