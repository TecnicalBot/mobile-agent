import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolExecutionRecord } from "@/core/types/app-state";
import type { AudioAnalysisSummary } from "@/modules/preview/video-audio-analysis";

const mocks = vi.hoisted(() => ({
  exists: true,
  fileSize: undefined as number | undefined,
  bytes: new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00]),
  getById: vi.fn(),
  transcribePcm16: vi.fn(),
  transcribePcm16WithSystem: vi.fn(),
  hasNative: false,
  transcribeLongAudio: vi.fn(),
  deletedUris: [] as string[],
  createTextFile: vi.fn(async (_input: { content: string }) => ({ id: "saved-transcript" })),
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({ createTextFile: mocks.createTextFile }),
  resolveWorkspaceFile: () => ({
    get exists() {
      return mocks.exists;
    },
    get size() {
      return mocks.fileSize;
    },
    uri: "file:///documents/audio/speech.mp3",
    bytes: async () => mocks.bytes,
  }),
}));

// The native lane builds its PCM cache through expo-file-system's File API,
// which needs a native runtime; the test double records deletions so the
// cache-ownership contract is observable.
vi.mock("expo-file-system", () => ({
  Paths: { cache: "/cache" },
  File: class {
    uri: string;
    constructor(directory: string, name: string) {
      this.uri = `file://${directory}/${name}`;
    }
    async delete() {
      mocks.deletedUris.push(this.uri);
    }
  },
}));

vi.mock("@/modules/voice/transcribe", () => ({
  transcribePcm16: mocks.transcribePcm16,
}));

vi.mock("@/modules/voice/windowed-transcribe", () => ({
  hasNativeAudioDecoder: () => mocks.hasNative,
  transcribeLongAudio: mocks.transcribeLongAudio,
}));

// The real system engine reaches for `react-native` (platform detection) and
// `expo-file-system`, neither of which is loadable here; it has its own tests.
vi.mock("@/modules/voice/system-transcribe", () => ({
  transcribePcm16WithSystem: mocks.transcribePcm16WithSystem,
}));

const { createTranscribeAudioTool } = await import(
  "@/modules/tools/built-in/transcribe-audio"
);
const { subscribeAudioAnalysis } = await import(
  "@/modules/preview/video-audio-analysis-job"
);

const SUMMARY: AudioAnalysisSummary = {
  ready: true,
  duration: 12.5,
  frameRate: 16,
  bpm: null,
  beatCount: 0,
  beats: [],
  curvePoints: 2,
  curveStepSeconds: 6.25,
  energy: [0.1, 0.2],
  low: [0, 0],
  mid: [0, 0],
  high: [0, 0],
  onset: [0, 0],
  pitch: [0, 0],
  noteCount: 0,
  notes: [],
  key: null,
  keyConfidence: null,
  tuningCents: null,
  voicedRatio: 0,
};

const TRANSCRIPT = {
  text: "hello world",
  language: "en",
  duration: 1.5,
  segments: [{ start: 0, end: 1.5, text: "hello world" }],
};

const SYSTEM_TRANSCRIPT = {
  text: "hello world",
  language: "en",
  duration: 1.5,
  segments: [{ start: 0, end: 1.5, text: "hello world" }],
  hasWordTimings: true,
  onDevice: true,
};

function repository(record: unknown) {
  mocks.getById.mockResolvedValue(record);
  return { getById: mocks.getById } as never;
}

const mp3Record = {
  id: "file-1",
  displayName: "speech.mp3",
  mimeType: "audio/mpeg",
  relativePath: "audio/speech.mp3",
};

describe("transcribeAudio tool", () => {
  let unsubscribe: (() => void) | null = null;

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    mocks.exists = true;
    mocks.fileSize = undefined;
    mocks.hasNative = false;
    mocks.getById.mockReset();
    mocks.transcribePcm16.mockReset();
    mocks.transcribePcm16WithSystem.mockReset();
    mocks.transcribeLongAudio.mockReset();
    mocks.deletedUris.length = 0;
  });

  it("rejects an unknown file id", async () => {
    const tool = createTranscribeAudioTool({
      repository: repository(null),
      onRecord: () => {},
    });
    await expect(tool.execute!({ fileId: "nope" }, {} as never)).rejects.toThrow(
      /No workspace file found/,
    );
  });

  it("rejects a file that is no longer present locally", async () => {
    mocks.exists = false;
    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    await expect(tool.execute!({ fileId: "file-1" }, {} as never)).rejects.toThrow(
      /no longer available/,
    );
  });

  it("rejects an unsupported audio format", async () => {
    const tool = createTranscribeAudioTool({
      repository: repository({
        ...mp3Record,
        displayName: "notes.txt",
        mimeType: "text/plain",
      }),
      onRecord: () => {},
    });
    await expect(tool.execute!({ fileId: "file-1" }, {} as never)).rejects.toThrow(
      /not a supported format/,
    );
  });

  it("requests 16 kHz PCM and returns the mapped transcript", async () => {
    const records: ToolExecutionRecord[] = [];
    let requestedPcmRate: number | undefined;
    unsubscribe = subscribeAudioAnalysis((job) => {
      requestedPcmRate = job.pcmSampleRate;
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16.mockResolvedValue(TRANSCRIPT);

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: (record) => records.push(record),
    });

    const out = (await tool.execute!({ fileId: "file-1" }, {} as never)) as {
      fileId: string;
      displayName: string;
      engine: string;
      language: string;
      duration: number;
      text: string;
      segmentCount: number;
      segments: unknown[];
    };

    expect(requestedPcmRate).toBe(16000);
    expect(mocks.transcribePcm16).toHaveBeenCalledWith(
      "AAAA",
      16000,
      expect.objectContaining({ language: "auto" }),
    );
    expect(mocks.transcribePcm16WithSystem).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      fileId: "file-1",
      displayName: "speech.mp3",
      engine: "whisper",
      language: "en",
      duration: 1.5,
      text: "hello world",
      segmentCount: 1,
      segments: [{ start: 0, end: 1.5, text: "hello world" }],
    });
    expect(out).not.toHaveProperty("warning");
    expect(records.at(-1)).toMatchObject({
      toolName: "transcribeAudio",
      status: "completed",
      mediaResult: { sourceFileId: "file-1", resultFileId: "saved-transcript" },
    });
    expect(out).toMatchObject({ resultFileId: "saved-transcript", resultLink: "workspace://saved-transcript" });
    expect(JSON.parse(mocks.createTextFile.mock.calls.at(-1)![0].content)).toMatchObject({
      text: "hello world", segments: TRANSCRIPT.segments,
    });
  });

  it("passes an explicit language through", async () => {
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16.mockResolvedValue(TRANSCRIPT);

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    await tool.execute!({ fileId: "file-1", language: "es" }, {} as never);

    expect(mocks.transcribePcm16).toHaveBeenCalledWith(
      "AAAA",
      16000,
      expect.objectContaining({ language: "es" }),
    );
  });

  it("fails when the decode host returns no PCM", async () => {
    const records: ToolExecutionRecord[] = [];
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY });
    });

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: (record) => records.push(record),
    });

    await expect(tool.execute!({ fileId: "file-1" }, {} as never)).rejects.toThrow(
      /cannot decode audio/,
    );
    expect(mocks.transcribePcm16).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({
      toolName: "transcribeAudio",
      status: "failed",
    });
  });

  it("records a failure when transcription throws", async () => {
    const records: ToolExecutionRecord[] = [];
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16.mockRejectedValue(new Error("No Whisper model"));

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: (record) => records.push(record),
    });

    await expect(tool.execute!({ fileId: "file-1" }, {} as never)).rejects.toThrow(
      /No Whisper model/,
    );
    expect(records.at(-1)).toMatchObject({
      toolName: "transcribeAudio",
      status: "failed",
    });
  });

  it("routes to the system engine when asked", async () => {
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16WithSystem.mockResolvedValue(SYSTEM_TRANSCRIPT);

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!(
      { fileId: "file-1", engine: "system", language: "de" },
      {} as never,
    )) as Record<string, unknown>;

    expect(mocks.transcribePcm16).not.toHaveBeenCalled();
    expect(mocks.transcribePcm16WithSystem).toHaveBeenCalledWith(
      "AAAA",
      16000,
      expect.objectContaining({ language: "de" }),
    );
    expect(out).toMatchObject({
      engine: "system",
      text: "hello world",
      segmentCount: 1,
    });
    expect(out).not.toHaveProperty("warning");
  });

  it("warns when the system engine returns no timed segments", async () => {
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16WithSystem.mockResolvedValue({
      ...SYSTEM_TRANSCRIPT,
      segments: [],
      hasWordTimings: false,
      onDevice: false,
    });

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!(
      { fileId: "file-1", engine: "system" },
      {} as never,
    )) as Record<string, unknown>;

    expect(out).toMatchObject({ engine: "system", segmentCount: 0 });
    expect(String(out.warning)).toMatch(/no timed `segments`/);
  });

  it("records a failure when the system engine throws", async () => {
    const records: ToolExecutionRecord[] = [];
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16WithSystem.mockRejectedValue(
      new Error("System transcription needs Android 13"),
    );

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: (record) => records.push(record),
    });

    await expect(
      tool.execute!({ fileId: "file-1", engine: "system" }, {} as never),
    ).rejects.toThrow(/Android 13/);
    expect(records.at(-1)).toMatchObject({
      toolName: "transcribeAudio",
      status: "failed",
    });
  });

  it("rejects when no analysis host is mounted", async () => {
    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    await expect(tool.execute!({ fileId: "file-1" }, {} as never)).rejects.toThrow(
      /only available on builds/,
    );
  });

  it("runs the native lane when the decoder is available and cleans up the PCM cache", async () => {
    mocks.hasNative = true;
    mocks.transcribeLongAudio.mockResolvedValue(TRANSCRIPT);

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!(
      { fileId: "file-1", maxSeconds: 300, language: "es" },
      {} as never,
    )) as Record<string, unknown>;

    expect(mocks.transcribeLongAudio).toHaveBeenCalledTimes(1);
    const call = mocks.transcribeLongAudio.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Plain paths (no file:// scheme) as the native module expects, a cache
    // file owned by the tool, and the caller's bounds passed through.
    expect(call.filePath).toBe("/documents/audio/speech.mp3");
    expect(call.pcmPath).toBe("/cache/transcribe-pcm-file-1");
    expect(call.maxSeconds).toBe(300);
    expect(call.language).toBe("es");
    // The legacy inline lane is not touched at all.
    expect(mocks.transcribePcm16).not.toHaveBeenCalled();
    expect(mocks.transcribePcm16WithSystem).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      engine: "whisper",
      language: "en",
      text: "hello world",
      segmentCount: 1,
    });
    // The PCM cache file is deleted however the run ends.
    expect(mocks.deletedUris).toEqual(["file:///cache/transcribe-pcm-file-1"]);
  });

  it("still deletes the PCM cache when the native lane fails", async () => {
    mocks.hasNative = true;
    mocks.transcribeLongAudio.mockRejectedValue(
      new Error("Decoder produce failed"),
    );

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    await expect(
      tool.execute!({ fileId: "file-1" }, {} as never),
    ).rejects.toThrow(/Decoder produce failed/);
    expect(mocks.deletedUris).toEqual(["file:///cache/transcribe-pcm-file-1"]);
  });

  it("keeps the system engine on the inline lane even when native decoding exists", async () => {
    // The system recognizer consumes what the WebAudio decode host returns;
    // the native decoder's PCM is only wired to Whisper.
    mocks.hasNative = true;
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16WithSystem.mockResolvedValue(SYSTEM_TRANSCRIPT);

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!(
      { fileId: "file-1", engine: "system" },
      {} as never,
    )) as Record<string, unknown>;

    expect(mocks.transcribeLongAudio).not.toHaveBeenCalled();
    expect(mocks.transcribePcm16WithSystem).toHaveBeenCalled();
    expect(out).toMatchObject({ engine: "system" });
    expect(mocks.deletedUris).toEqual([]);
  });

  it("names the missing native decoder when an oversized file falls back to inline", async () => {
    // The 15 MB cap is a decode-buffer limit, not a model limit: a 123 MB
    // video on a build without the native decoder can never be transcribed,
    // however many Whisper models are installed.
    mocks.fileSize = 123 * 1024 * 1024;

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });

    const error = await Promise.resolve(
      tool.execute!({ fileId: "file-1" }, {} as never),
    ).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/does not include the native audio decoder/);
    expect((error as Error).message).toMatch(/installing a Whisper model does not raise this cap/);
    // The whole file is never read into the heap.
    expect(mocks.transcribePcm16).not.toHaveBeenCalled();
  });

  it("points the system engine at whisper for oversized files", async () => {
    // The system engine always decodes inline, even on builds with the
    // native decoder, so its 15 MB cap needs a different way out.
    mocks.hasNative = true;
    mocks.fileSize = 123 * 1024 * 1024;

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });

    await expect(
      tool.execute!({ fileId: "file-1", engine: "system" }, {} as never),
    ).rejects.toThrow(/system recognizer.*engine "whisper"/);
    expect(mocks.transcribePcm16WithSystem).not.toHaveBeenCalled();
  });

  it("reports a truncated native transcript so the agent can raise maxSeconds", async () => {
    mocks.hasNative = true;
    mocks.transcribeLongAudio.mockResolvedValue({
      ...TRANSCRIPT,
      duration: 90,
      sourceDuration: 600,
      truncated: true,
    });

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!(
      { fileId: "file-1", maxSeconds: 90 },
      {} as never,
    )) as Record<string, unknown>;

    expect(out).toMatchObject({
      duration: 90,
      sourceDuration: 600,
      truncated: true,
    });
    expect(String(out.warning)).toMatch(/Only the first 90 s of a 600 s recording/);
    expect(String(out.warning)).toMatch(/larger maxSeconds/);
  });

  it("reports truncation from the inline host summary", async () => {
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({
        summary: { ...SUMMARY, duration: 90, sourceDuration: 600 },
        pcm: { base64: "AAAA", sampleRate: 16000 },
      });
    });
    mocks.transcribePcm16.mockResolvedValue({ ...TRANSCRIPT, duration: 90 });

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!(
      { fileId: "file-1", maxSeconds: 90 },
      {} as never,
    )) as Record<string, unknown>;

    expect(out).toMatchObject({ sourceDuration: 600, truncated: true });
    expect(String(out.warning)).toMatch(/larger maxSeconds/);
  });

  it("omits truncation fields when the whole recording was transcribed", async () => {
    unsubscribe = subscribeAudioAnalysis((job) => {
      job.resolve({ summary: SUMMARY, pcm: { base64: "AAAA", sampleRate: 16000 } });
    });
    mocks.transcribePcm16.mockResolvedValue(TRANSCRIPT);

    const tool = createTranscribeAudioTool({
      repository: repository(mp3Record),
      onRecord: () => {},
    });
    const out = (await tool.execute!({ fileId: "file-1" }, {} as never)) as Record<
      string,
      unknown
    >;

    expect(out).not.toHaveProperty("truncated");
    expect(out).not.toHaveProperty("warning");
  });
});
