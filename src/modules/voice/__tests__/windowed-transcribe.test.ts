import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformOS: "android" as string,
  initWhisper: vi.fn(),
  transcribeData: vi.fn(),
  release: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  downloaded: vi.fn(() => true),
  resolveModel: vi.fn(async () => "base" as string | null),
  decodeCalls: [] as { path: string; maxSeconds: number }[],
  pcmFiles: new Map<string, Uint8Array>(),
  readCalls: [] as { path: string; offset: number; count: number }[],
  sampleRate: 8000,
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platformOS;
    },
  },
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => null,
}));

vi.mock("html-video-export", () => ({
  getHtmlVideoExportModule: () => ({
    decodeAudioPcm: async (path: string, pcmPath: string, maxSeconds: number) => {
      mocks.decodeCalls.push({ path, maxSeconds });
      const source = mocks.pcmFiles.get(path);
      if (source === undefined) {
        throw new Error(`No fixture registered for ${path}.`);
      }
      // The real op writes decoded PCM to pcmPath; stage it there for reads.
      mocks.pcmFiles.set(pcmPath, source);
      // Metadata mirrors what MediaCodec would report for the fixture.
      return {
        pcmPath,
        bytes: source.length,
        sampleRate: mocks.sampleRate,
        channels: 1,
        durationSeconds: (source.length / 2) / mocks.sampleRate,
      };
    },
    readPcmSegment: async (path: string, offset: number, count: number) => {
      mocks.readCalls.push({ path, offset, count });
      const bytes = mocks.pcmFiles.get(path)!;
      const slice = bytes.subarray(offset, offset + count);
      let binary = "";
      for (const byte of slice) binary += String.fromCharCode(byte);
      return { base64: btoa(binary), bytes: slice.length };
    },
  }),
}));

vi.mock("@/modules/voice/models", () => ({
  isModelDownloaded: mocks.downloaded,
  modelFile: () => ({ uri: "file:///models/ggml-base.bin" }),
  resolveTranscriptionModel: mocks.resolveModel,
}));

vi.mock("whisper.rn/index", () => ({
  initWhisper: mocks.initWhisper,
}));

const { hasNativeAudioDecoder, transcribeLongAudio, WINDOW_SECONDS } = await import(
  "@/modules/voice/windowed-transcribe"
);

/** Fixture registry for the fake decoder; imported modules read it. */
const fake = {
  sampleRate: 8000,
  set pcm(int16: Int16Array) {
    const bytes = new Uint8Array(int16.length * 2);
    const view = new DataView(bytes.buffer);
    int16.forEach((sample, index) => view.setInt16(index * 2, sample, true));
    mocks.pcmFiles.set("file:///solo.pcm", bytes);
  },
};

function encodePcm16(samples: number[]) {
  const bytes = new Int16Array(samples.length);
  samples.forEach((sample, index) => {
    bytes[index] = sample;
  });
  return bytes;
}

type WhisperWindowResultLike = {
  result: string;
  language: string;
  isAborted: boolean;
  segments: { text: string; t0: number; t1: number }[];
};

function whisperResult(overrides: Record<string, unknown> = {}) {
  return {
    result: " alpha one",
    language: "en",
    isAborted: false,
    segments: [{ text: " alpha one", t0: 200, t1: 400 }],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.platformOS = "android";
  mocks.pcmFiles.clear();
  mocks.decodeCalls.length = 0;
  mocks.readCalls.length = 0;
  vi.clearAllMocks();
  mocks.initWhisper.mockResolvedValue({
    transcribeData: mocks.transcribeData,
    release: mocks.release,
  });
  mocks.stop.mockReset();
  mocks.release.mockClear();
  mocks.transcribeData.mockReset();
  mocks.transcribeData.mockImplementation(() => ({
    stop: mocks.stop,
    promise: Promise.resolve(whisperResult()),
  }));
});

describe("hasNativeAudioDecoder", () => {
  it("is false off Android", async () => {
    mocks.platformOS = "ios";
    expect(hasNativeAudioDecoder()).toBe(false);
  });

  it("is true on Android with the module present", () => {
    expect(hasNativeAudioDecoder()).toBe(true);
  });
});

describe("transcribeLongAudio", () => {
  it("feeds consecutive 30 s windows and offsets their segments", async () => {
    // 8000 Hz mono × 2 bytes: one window = 480 000 bytes. Build 90 s of PCM
    // so the fixture produces exactly 3 windows.
    fake.pcm = encodePcm16(new Array(90 * 8000).fill(0));
    mocks.transcribeData
      .mockImplementationOnce(() => ({
        stop: mocks.stop,
        promise: Promise.resolve(
          whisperResult({
            result: " first words",
            segments: [{ text: "first words", t0: 100, t1: 2900 }],
          }),
        ),
      }))
      .mockImplementationOnce(() => ({
        stop: mocks.stop,
        promise: Promise.resolve(
          whisperResult({
            result: " second words",
            language: "de",
            segments: [{ text: "second words", t0: 0, t1: 150 }],
          }),
        ),
      }));

    const transcript = await transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 90,
    });

    expect(mocks.decodeCalls).toEqual([
      { path: "file:///solo.pcm", maxSeconds: 90 },
    ]);
    expect(mocks.initWhisper).toHaveBeenCalledTimes(1);
    expect(mocks.transcribeData).toHaveBeenCalledTimes(3);
    expect(mocks.release).toHaveBeenCalledTimes(1);

    // Read windows: three 480 000-byte reads aligned to the window grid.
    expect(mocks.readCalls).toEqual([
      { path: "file:///cache/solo.pcm", offset: 0, count: 480000 },
      { path: "file:///cache/solo.pcm", offset: 480000, count: 480000 },
      { path: "file:///cache/solo.pcm", offset: 960000, count: 480000 },
    ]);

    // Windows 1 and 2 carry their text; window 3 (default result) appends.
    expect(transcript.text).toBe("first words second words alpha one");
    // Segments are offset back onto the whole-file timeline.
    expect(transcript.segments).toHaveLength(3);
    expect(transcript.segments[0]).toMatchObject({ start: 1, end: 29 });
    expect(transcript.segments[1]).toMatchObject({ start: 30, end: 31.5 });
    expect(transcript.segments[2]).toMatchObject({ start: 62, end: 64 });
    // Language locks on the first text-bearing window: "en" from window 1,
    // not the later window's "de".
    expect(transcript.language).toBe("en");
    // Duration reports the decoded window, not the whole fixture.
    expect(transcript.duration).toBe(90);
    // The decode covered the whole track, so nothing is flagged as clipped.
    expect(transcript.sourceDuration).toBe(90);
    expect(transcript.truncated).toBe(false);
  });

  it("flags a maxSeconds-clipped track with its full source duration", async () => {
    fake.pcm = encodePcm16(new Array(90 * 8000).fill(0));
    const transcript = await transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 30,
    });

    // The decoder reports the track length even though only the first
    // `maxSeconds` were decoded, so callers can tell the transcript is partial.
    expect(transcript.duration).toBe(30);
    expect(transcript.sourceDuration).toBe(90);
    expect(transcript.truncated).toBe(true);
  });

  it("chains the previous window's tail as the prompt", async () => {
    fake.pcm = encodePcm16(new Array(60 * 8000).fill(0));
    await transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 60,
    });

    const firstOptions = mocks.transcribeData.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const secondOptions = mocks.transcribeData.mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(firstOptions.prompt).toBeUndefined();
    expect(secondOptions.prompt).toBe("alpha one");
  });

  it("locks the requested language across every window", async () => {
    fake.pcm = encodePcm16(new Array(60 * 8000).fill(0));
    await transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 60,
      language: "es",
    });

    for (const call of mocks.transcribeData.mock.calls) {
      expect((call[1] as Record<string, unknown>).language).toBe("es");
    }
  });

  it("clamps a hallucinated segment tail to the window extent", async () => {
    fake.pcm = encodePcm16(new Array(31 * 8000).fill(0));
    mocks.transcribeData.mockImplementationOnce(() => ({
      stop: mocks.stop,
      promise: Promise.resolve(
        whisperResult({
          segments: [{ text: "runs long", t0: 0, t1: 5500 }],
        }),
      ),
    }));
    const transcript = await transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 31,
    });
    expect(transcript.segments[0].end).toBe(WINDOW_SECONDS);
  });

  it("reports monotonic per-window progress", async () => {
    fake.pcm = encodePcm16(new Array(60 * 8000).fill(0));
    const progress: number[] = [];
    await transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 60,
      onProgress: ({ bytesWritten }) => progress.push(bytesWritten),
    });
    expect(progress).toEqual([0, 50, 100]);
  });

  it("stops the running whisper task on abort", async () => {
    fake.pcm = encodePcm16(new Array(60 * 8000).fill(0));
    const controller = new AbortController();
    // Window 2 creates a task whose promise only settles when stop() is
    // called — mirroring real whisper tasks, whose promise resolves with
    // isAborted once stopped.
    mocks.transcribeData
      .mockImplementationOnce(() => ({
        stop: mocks.stop,
        promise: Promise.resolve(whisperResult()),
      }))
      .mockImplementationOnce(() => {
        let settle: (value: WhisperWindowResultLike) => void = () => {};
        const promise = new Promise<WhisperWindowResultLike>((resolve) => {
          settle = resolve;
        });
        return {
          stop: async () => {
            mocks.stop();
            settle({
              result: "",
              language: "",
              isAborted: true,
              segments: [],
            });
          },
          promise,
        };
      });

    const run = transcribeLongAudio({
      filePath: "file:///solo.pcm",
      pcmPath: "file:///cache/solo.pcm",
      maxSeconds: 60,
      signal: controller.signal,
    });

    // Wait until window 2's task is the active one, then abort. The listener
    // must stop the *running* task — that's the contract under test.
    await vi.waitFor(() => {
      expect(mocks.transcribeData).toHaveBeenCalledTimes(2);
    });
    controller.abort();

    await expect(run).rejects.toThrow("Transcription was cancelled.");
    expect(mocks.stop).toHaveBeenCalled();
    // The context is still released on the cancel path.
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("surfaces missing-model failures before decoding", async () => {
    mocks.resolveModel.mockResolvedValue(null);
    await expect(
      transcribeLongAudio({
        filePath: "file:///solo.pcm",
        pcmPath: "file:///cache/solo.pcm",
        maxSeconds: 30,
      }),
    ).rejects.toThrow("No Whisper model is available");
    expect(mocks.decodeCalls).toHaveLength(0);
  });

  it("rejects when no model is downloaded", async () => {
    mocks.downloaded.mockReturnValue(false);
    mocks.resolveModel.mockResolvedValue("large");
    await expect(
      transcribeLongAudio({
        filePath: "file:///solo.pcm",
        pcmPath: "file:///cache/solo.pcm",
        maxSeconds: 30,
      }),
    ).rejects.toThrow("Whisper model is missing");
    expect(mocks.decodeCalls).toHaveLength(0);
  });
});
