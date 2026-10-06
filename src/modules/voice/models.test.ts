import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WHISPER_MODELS,
  cancelVoiceDownload,
  deleteVoiceModel,
  downloadVoiceModel,
  isModelDownloaded,
  loadVoiceEngine,
  saveVoiceEngine,
} from "./models";

const mocks = vi.hoisted(() => ({
  files: new Map<string, { size: number; text?: string }>(),
  download: vi.fn<() => Promise<{ status: number } | undefined>>(),
  cancel: vi.fn(async () => {}),
  uri: "",
  progress: null as
    | null
    | ((data: {
        totalBytesWritten: number;
        totalBytesExpectedToWrite: number;
      }) => void),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///document" },
  Directory: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((p) => (typeof p === "string" ? p : p.uri))
        .join("/");
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((p) => (typeof p === "string" ? p : p.uri))
        .join("/");
    }
    get exists() {
      return mocks.files.has(this.uri);
    }
    get size() {
      return mocks.files.get(this.uri)?.size ?? 0;
    }
    async text() {
      return mocks.files.get(this.uri)?.text ?? "";
    }
    write(text: string) {
      mocks.files.set(this.uri, { size: text.length, text });
    }
    delete() {
      mocks.files.delete(this.uri);
    }
    move(to: { uri: string }) {
      mocks.files.set(to.uri, mocks.files.get(this.uri)!);
      mocks.files.delete(this.uri);
      this.uri = to.uri;
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: (
    _url: string,
    uri: string,
    _options: unknown,
    progress: typeof mocks.progress,
  ) => {
    mocks.uri = uri;
    mocks.progress = progress;
    return { downloadAsync: mocks.download, cancelAsync: mocks.cancel };
  },
}));

describe("Whisper model downloads and selection", () => {
  beforeEach(() => {
    mocks.files.clear();
    vi.clearAllMocks();
  });
  it("defaults to System and refuses models that are not installed", async () => {
    expect(await loadVoiceEngine()).toBe("system");
    expect(() => saveVoiceEngine("tiny")).toThrow("Download");
  });
  it("publishes only complete downloads and remembers selection", async () => {
    mocks.download.mockImplementation(async () => {
      mocks.files.set(mocks.uri, { size: WHISPER_MODELS[0].bytes });
      mocks.progress!({
        totalBytesWritten: WHISPER_MODELS[0].bytes,
        totalBytesExpectedToWrite: WHISPER_MODELS[0].bytes,
      });
      return { status: 200 };
    });
    const progress = vi.fn();
    await downloadVoiceModel("tiny", progress);
    expect(isModelDownloaded("tiny")).toBe(true);
    expect(progress).toHaveBeenCalledWith(1);
    saveVoiceEngine("tiny");
    expect(await loadVoiceEngine()).toBe("tiny");
    await deleteVoiceModel("tiny");
    expect(await loadVoiceEngine()).toBe("system");
    expect(isModelDownloaded("tiny")).toBe(false);
  });
  it("rejects truncated downloads and removes partial files", async () => {
    mocks.download.mockImplementation(async () => {
      mocks.files.set(mocks.uri, { size: 100 });
      return { status: 200 };
    });
    await expect(downloadVoiceModel("tiny", vi.fn())).rejects.toThrow(
      "incomplete",
    );
    expect(isModelDownloaded("tiny")).toBe(false);
    expect(mocks.files.has(mocks.uri)).toBe(false);
  });
  it("cancels downloads without installing partial models", async () => {
    mocks.download.mockImplementation(async () => {
      mocks.files.set(mocks.uri, { size: 100 });
      await cancelVoiceDownload();
      throw new Error("cancelled");
    });
    await downloadVoiceModel("tiny", vi.fn());
    expect(isModelDownloaded("tiny")).toBe(false);
    expect(mocks.files.has(mocks.uri)).toBe(false);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
});
