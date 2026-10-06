import { beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalVoiceSession } from "./local-session";

const mocks = vi.hoisted(() => ({
  buffer: null as
    | null
    | ((buffer: {
        data: ArrayBuffer;
        sampleRate: number;
        channels: number;
        timestamp: number;
      }) => void),
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  releaseStream: vi.fn(),
  releaseContext: vi.fn(async () => {}),
  remove: vi.fn(),
  permissions: vi.fn(async () => ({ granted: true })),
  audioMode: vi.fn(async () => {}),
  downloaded: vi.fn(() => true),
  abort: vi.fn(async () => {}),
  transcribe: vi.fn(() => ({
    stop: async () => {},
    promise: Promise.resolve({ result: " hello world ", isAborted: false }),
  })),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("./models", () => ({
  isModelDownloaded: mocks.downloaded,
  modelFile: () => ({ uri: "file:///models/ggml-tiny.bin" }),
}));
vi.mock("expo-audio", () => ({
  requestRecordingPermissionsAsync: mocks.permissions,
  setAudioModeAsync: mocks.audioMode,
  AudioModule: {
    AudioStream: class {
      addListener(_event: string, callback: typeof mocks.buffer) {
        mocks.buffer = callback;
        return { remove: mocks.remove };
      }
      start = mocks.start;
      stop = mocks.stop;
      release = mocks.releaseStream;
    },
  },
}));
vi.mock("whisper.rn/index", () => ({
  initWhisper: async () => ({
    transcribeData: mocks.transcribe,
    release: mocks.releaseContext,
  }),
}));

function audio(seconds = 1) {
  const data = new Float32Array(16000 * seconds).fill(0.1);
  mocks.buffer!({
    data: data.buffer,
    sampleRate: 16000,
    channels: 1,
    timestamp: 0,
  });
}

describe("Local Whisper voice session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloaded.mockReturnValue(true);
    mocks.permissions.mockResolvedValue({ granted: true });
    mocks.transcribe.mockImplementation(() => ({
      stop: mocks.abort,
      promise: Promise.resolve({ result: " hello world ", isAborted: false }),
    }));
  });
  it("transcribes once on confirm, reports volume and releases native resources", async () => {
    const level = vi.fn();
    const session = await startLocalVoiceSession("tiny", level, vi.fn());
    audio();
    const first = session.finish();
    expect(session.finish()).toBe(first);
    expect(await first).toBe("hello world");
    expect(level).toHaveBeenCalled();
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(mocks.releaseContext).toHaveBeenCalledTimes(1);
    expect(mocks.releaseStream).toHaveBeenCalledTimes(1);
  });
  it("discards recording on cancel without transcription", async () => {
    const session = await startLocalVoiceSession("tiny", vi.fn(), vi.fn());
    audio();
    await session.cancel();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.releaseContext).toHaveBeenCalledTimes(1);
  });
  it("does not transcribe an empty recording", async () => {
    const session = await startLocalVoiceSession("base", vi.fn(), vi.fn());
    expect(await session.finish()).toBe("");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("suppresses transcription that completes after cancellation", async () => {
    let resolve!: (value: { result: string; isAborted: boolean }) => void;
    mocks.transcribe.mockImplementation(() => ({
      stop: mocks.abort,
      promise: new Promise((done) => {
        resolve = done;
      }),
    }));
    const session = await startLocalVoiceSession("tiny", vi.fn(), vi.fn());
    audio();
    const result = session.finish();
    const cancel = session.cancel();
    resolve({ result: "late text", isAborted: false });
    await cancel;
    expect(await result).toBe("");
    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.releaseContext).toHaveBeenCalledTimes(1);
  });
  it("releases resources when microphone startup fails", async () => {
    mocks.start.mockRejectedValueOnce(new Error("Microphone unavailable"));
    await expect(
      startLocalVoiceSession("tiny", vi.fn(), vi.fn()),
    ).rejects.toThrow("Microphone unavailable");
    expect(mocks.releaseContext).toHaveBeenCalledTimes(1);
    expect(mocks.releaseStream).toHaveBeenCalledTimes(1);
  });
  it("stops at the two minute limit", async () => {
    const limit = vi.fn();
    const session = await startLocalVoiceSession("tiny", vi.fn(), limit);
    audio(120);
    audio();
    expect(limit).toHaveBeenCalledTimes(1);
    await session.cancel();
  });
  it("rejects missing models and denied microphone permission", async () => {
    mocks.downloaded.mockReturnValue(false);
    await expect(
      startLocalVoiceSession("tiny", vi.fn(), vi.fn()),
    ).rejects.toThrow("missing");
    mocks.downloaded.mockReturnValue(true);
    mocks.permissions.mockResolvedValue({ granted: false });
    await expect(
      startLocalVoiceSession("tiny", vi.fn(), vi.fn()),
    ).rejects.toThrow("Microphone access");
  });
});
