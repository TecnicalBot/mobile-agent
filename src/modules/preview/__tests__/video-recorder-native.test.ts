import { afterEach, describe, expect, it, vi } from "vitest";

import { VIDEO_EXPORT_SCRIPT } from "@/modules/preview/video-recorder";
import { VIDEO_AUDIO_ANALYSIS_SCRIPT } from "@/modules/preview/video-audio-analysis";

type Posted = { type: string; [key: string]: unknown };

function installStubs(options: {
  withWebCodecs?: boolean;
  autoConsume?: boolean;
  withAudio?: boolean;
  video?: object;
  videos?: object[];
  audio?: false | object;
  render?: () => void;
  clipApi?: object;
  image?: object;
  duration?: number;
  shots?: object[];
  documentHtml?: string;
} = {}) {
  const messages: Posted[] = [];
  const createVideoEncoder = vi.fn(() => { throw new Error("Native export must not construct a WebCodecs encoder."); });
  const g = globalThis as Record<string, unknown>;
  class FakeOfflineAudioContext {
    sampleRate = 48000;
    destination = {};
    constructor(_channels: number, private frames: number, _rate: number) {}
    createGain() {
      return {
        gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
      };
    }
    createBufferSource() {
      return { connect() {}, start() {}, stop() {}, buffer: null, loop: false };
    }
    decodeAudioData() {
      return Promise.resolve({ duration: 1 });
    }
    startRendering() {
      return Promise.resolve({
        length: this.frames,
        numberOfChannels: 2,
        sampleRate: 48000,
        getChannelData: (channel: number) => new Float32Array(this.frames).fill(channel === 0 ? 0.25 : -0.25),
      });
    }
  }
  if (options.withAudio) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  }

  const canvas = {
    width: 320,
    height: 240,
    offsetWidth: 320,
    parentNode: null,
    nextSibling: null,
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    getContext: () => ({}),
    toDataURL: () => "data:image/jpeg;base64,/9j/4AAQ==",
  };

  g.window = {
    MOBILE_AGENT_VIDEO: {
      duration: options.duration ?? 1,
      fps: 5,
      width: 320,
      height: 240,
      render: options.render ?? (() => {}),
      audio: options.audio ?? false,
      ...(options.withAudio ? { audio: { tracks: [{ file: "data:audio/wav;base64,AAAA" }] } } : {}),
      ...(options.shots ? { shots: options.shots } : {}),
    },
    ReactNativeWebView: {
      postMessage: (data: string) => {
        const message = JSON.parse(data);
        messages.push(message);
        if (options.autoConsume !== false && message.requestId !== undefined) {
          (g.window as Record<string, (id: number) => void>).__mobileAgentExportConsumed(message.requestId);
        }
      },
    },
    ...(options.withWebCodecs !== false ? { VideoEncoder: createVideoEncoder, VideoFrame: class {} } : {}),
    OfflineAudioContext: FakeOfflineAudioContext,
    __mobileAgentClips: options.clipApi,
  };
  g.document = {
    documentElement: { outerHTML: options.documentHtml ?? "" },
    getElementById: () => null,
    querySelectorAll: (selector: string) =>
      selector === "video"
         ? (options.videos ?? (options.video ? [options.video] : []))
        : selector === "img[data-mobile-agent-asset]"
          ? (options.image ? [options.image] : [])
          : [canvas],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
    body: { appendChild: () => {} },
  };
  if (options.withWebCodecs !== false) {
    g.VideoEncoder = createVideoEncoder;
    g.VideoFrame = class {};
  }

  new Function(VIDEO_AUDIO_ANALYSIS_SCRIPT)();
  new Function(VIDEO_EXPORT_SCRIPT)();

  const w = g.window as Record<string, () => void>;
  return {
    messages,
    createVideoEncoder,
    start: () => w.__startMobileAgentVideoExport(),
    startAt: (offset: number, length: number) =>
      (w.__startMobileAgentVideoExport as (o: number, l: number) => void)(offset, length),
    probe: () => (w.__probeMobileAgentVideo as () => void)(),
    consume: (id: number) => (g.window as Record<string, (id: number) => void>).__mobileAgentExportConsumed(id),
    cancel: () => w.__cancelMobileAgentVideoExport(),
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.VideoEncoder;
  delete g.VideoFrame;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("VIDEO_EXPORT_SCRIPT native encoding", () => {
  it("rejects accidental silent composites before capturing any frames", async () => {
    const { messages, start } = installStubs({ video: {} });
    delete (globalThis as unknown as { window: { MOBILE_AGENT_VIDEO: { audio?: unknown } } }).window.MOBILE_AGENT_VIDEO.audio;
    start();
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoError")).toBe(true));
    expect(messages.find((m) => m.type === "mobileAgentVideoError")?.message).toMatch(/main video soundtrack/);
    expect(messages.some((m) => m.type === "mobileAgentVideoFrame")).toBe(false);
  });

  it("allows explicitly silent video scenes", async () => {
    const { messages, start } = installStubs({ video: {}, audio: false });
    start();
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoDone")).toBe(true));
    expect(messages.some((m) => m.type === "mobileAgentVideoAudioConfig")).toBe(false);
  });

  it("rejects empty audio schedules rather than exporting silence", async () => {
    const { messages, start } = installStubs({ audio: { tracks: [] } });
    start();
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoError")).toBe(true));
    expect(messages.find((m) => m.type === "mobileAgentVideoError")?.message).toMatch(/no usable tracks/);
  });

  it("fails before capture when render starts a second async seek", async () => {
    const video = {
      duration: 30.421, readyState: 2, seeking: false, currentTime: 0, loop: false,
      pause() {}, addEventListener() {}, removeEventListener() {},
    };
    const { messages, start } = installStubs({ video, render: () => {
      video.currentTime = 0.5;
      video.seeking = true;
      video.readyState = 1;
    } });
    start();
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoError")).toBe(true));
    expect(messages.find((m) => m.type === "mobileAgentVideoError")?.message).toMatch(/render\(\).*changed.*source video frame/);
    expect(messages.some((m) => m.type === "mobileAgentVideoFrame")).toBe(false);
  });

  it("still seeks an undeclared video when another video is timeline-owned", async () => {
    const makeVideo = () => ({
      duration: 2, readyState: 2, seeking: false, currentTime: 0, loop: false,
      pause() {}, addEventListener() {}, removeEventListener() {},
      toString: () => "[object HTMLVideoElement]",
    });
    const owned = makeVideo();
    const unowned = makeVideo();
    const prepareFrame = vi.fn(async () => {});
    const { messages, start } = installStubs({
      videos: [owned, unowned],
      clipApi: { attach: () => ({ prepareFrame, ownedElements: () => [owned] }) },
    });
    start();
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoDone")).toBe(true));
    expect(owned.currentTime).toBe(0);
    expect(unowned.currentTime).toBeCloseTo(0.8);
    expect(messages.find((m) => m.type === "mobileAgentVideoDone")?.visualWarnings).toEqual([
      expect.stringContaining("1 of 2 video elements are not declared"),
    ]);
  });
  it("uses native frames even when WebCodecs is available", async () => {
    const { messages, createVideoEncoder, start } = installStubs();
    start();

    await vi.waitFor(
      () =>
        expect(
          messages.some((m) => m.type === "mobileAgentVideoDone"),
        ).toBe(true),
      { timeout: 8000 },
    );

    expect(createVideoEncoder).not.toHaveBeenCalled();
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(5);
    expect(messages.some((m) => m.type === "mobileAgentVideoCsd")).toBe(false);
    // Silent scenes run no soundtrack prep; the field is present and zero.
    const done = messages.find((m) => m.type === "mobileAgentVideoDone");
    expect((done?.timings as { audioPrepMs?: number } | undefined)?.audioPrepMs).toBe(0);
  }, 15000);

  it("works when WebCodecs is unavailable", async () => {
    const { messages, createVideoEncoder, start } = installStubs({ withWebCodecs: false });
    start();

    await vi.waitFor(
      () =>
        expect(
          messages.some((m) => m.type === "mobileAgentVideoDone"),
        ).toBe(true),
      { timeout: 8000 },
    );

    expect(createVideoEncoder).not.toHaveBeenCalled();
    expect(messages.some((m) => m.type === "mobileAgentVideoEncodedChunk")).toBe(false);
  }, 15000);

  it("never produces a second frame before native acknowledges the first", async () => {
    const { messages, start, consume, cancel } = installStubs({ autoConsume: false });
    start();
    await vi.waitFor(() => expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(1));
    const first = messages.find((m) => m.type === "mobileAgentVideoFrame")!;
    consume(Number(first.requestId) + 100); // Stale/unrelated ACK cannot release it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(1);
    consume(Number(first.requestId));
    await vi.waitFor(() => expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(2));
    cancel();
  });

  it("exports the complete offline soundtrack with sample-derived timestamps", async () => {
    const { messages, start } = installStubs({ withAudio: true });
    start();
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoDone")).toBe(true), { timeout: 8000 });
    expect(messages.find((m) => m.type === "mobileAgentVideoAudioConfig")).toMatchObject({ encoding: "pcm16", sampleRate: 48000, channels: 2 });
    const pcm = messages.filter((m) => m.type === "mobileAgentVideoAudioPcmChunk");
    expect(pcm.length).toBeGreaterThan(1);
    let bytesSent = 0;
    for (const chunk of pcm) {
      expect(chunk.pts).toBe(Math.round(bytesSent / 4 * 1_000_000 / 48000));
      const bytes = Buffer.from(String(chunk.base64), "base64");
      expect(bytes.readInt16LE(0)).toBe(8192);
      expect(bytes.readInt16LE(2)).toBe(-8192);
      bytesSent += bytes.length;
    }
    expect(bytesSent).toBe(48000 * 2 * 2);
    expect(messages.findIndex((m) => m.type === "mobileAgentVideoAudioPcmChunk")).toBeGreaterThan(
      messages.findLastIndex((m) => m.type === "mobileAgentVideoFrame"),
    );
  });

  it("restarts the soundtrack clock at zero for a later segment page", async () => {
    // Regression for 50bb719: a segment page used to stamp its PCM chunks
    // with absolute (segment-offset-anchored) timestamps, tripping the
    // native encoder's from-zero sample-count clock ("Non-contiguous PCM
    // soundtrack") on every audio render past the first 30 s segment — and
    // would have misplaced the track inside the segment MP4 besides.
    const { messages, startAt } = installStubs({ withAudio: true, duration: 60 });
    startAt(30, 30);

    await vi.waitFor(
      () => expect(messages.some((m) => m.type === "mobileAgentVideoDone")).toBe(true),
      { timeout: 15000 },
    );
    const pcm = messages.filter((m) => m.type === "mobileAgentVideoAudioPcmChunk");
    expect(pcm.length).toBeGreaterThan(1);
    // Each segment file re-serves a fresh native encoder whose clock starts
    // at zero, so the first chunk must land there…
    expect(pcm[0].pts).toBe(0);
    expect(pcm[0].pts).not.toBe(30_000_000);
    // …and stay contiguous on that clock within the encoder's ±2µs guard.
    let bytesSent = 0;
    for (const chunk of pcm) {
      const native = Math.trunc(bytesSent / 4 * 1_000_000 / 48000);
      expect(Math.abs(Number(chunk.pts) - native)).toBeLessThanOrEqual(2);
      bytesSent += Buffer.from(String(chunk.base64), "base64").length;
    }
    // A full 30 s segment of interleaved stereo PCM16 at 48 kHz.
    expect(bytesSent).toBe(30 * 48000 * 4);
  }, 30000);

  it("waits for source-video seeks before posting frames", async () => {
    const events = new Map<string, () => void>();
    let time = 0.5;
    let finishSeek: (() => void) | undefined;
    const video = {
      duration: 1, readyState: 2, seeking: false, loop: false,
      pause() {},
      get currentTime() { return time; },
      set currentTime(value: number) {
        time = value;
        video.seeking = true;
        finishSeek = () => { video.seeking = false; events.get("seeked")?.(); };
      },
      addEventListener(name: string, listener: () => void) { events.set(name, listener); },
      removeEventListener(name: string) { events.delete(name); },
    };
    const { messages, start, cancel } = installStubs({ video });
    start();
    await vi.waitFor(() => expect(finishSeek).toBeDefined());
    expect(time).toBe(0);
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(0);
    finishSeek!();
    await vi.waitFor(() => expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(1));
    cancel();
    finishSeek?.(); // Release any second-frame seek started before cancellation.
  });

  it("reloads a source video stalled at readyState 1 instead of dying", async () => {
    vi.useFakeTimers();
    const events = new Map<string, () => void>();
    let time = 0.5;
    let loadCalls = 0;
    // Metadata loaded (readyState 1) but no data ever arrives: the frame
    // stays un-decodable — the exact stall that used to kill the export at
    // the 15 s watchdog.
    const video = {
      duration: 1, readyState: 1, seeking: false, loop: false,
      pause() {},
      load() { loadCalls += 1; video.readyState = 2; },
      get currentTime() { return time; },
      set currentTime(value: number) { time = value; },
      addEventListener(name: string, listener: () => void) { events.set(name, listener); },
      removeEventListener(name: string) { events.delete(name); },
    };
    const { messages, start, cancel } = installStubs({ video });
    start();
    await vi.advanceTimersByTimeAsync(0);

    // First watchdog fires: the element re-runs resource selection.
    await vi.advanceTimersByTimeAsync(15_100);
    expect(loadCalls).toBe(1);

    // The reload decoded the frame — the export continues and posts.
    await vi.advanceTimersByTimeAsync(0);
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame").length).toBeGreaterThan(0);
    cancel();
  });

  function fakeImage(init: { complete: boolean; naturalWidth?: number; src?: string }) {
    const events = new Map<string, () => void>();
    const img: Record<string, unknown> = {
      src: init.src ?? "http://127.0.0.1:9999/files/img-1/photo.png",
      complete: init.complete,
      naturalWidth: init.complete ? (init.naturalWidth ?? 0) : 0,
      addEventListener: (name: string, listener: () => void) => { events.set(name, listener); },
      removeEventListener: (name: string) => { events.delete(name); },
    };
    return { img, fire: (name: string) => events.get(name)?.() };
  }

  it("fails loud with the source when a workspace image never decodes", async () => {
    const { img } = fakeImage({ complete: true, naturalWidth: 0 });
    const { messages, start } = installStubs({ image: img });
    start();

    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoError")).toBe(true));
    const error = messages.find((m) => m.type === "mobileAgentVideoError");
    expect(error?.message).toMatch(/scene image could not be decoded/);
    expect(error?.message).toContain("photo.png");
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(0);
  });

  it("waits for a still-loading workspace image before capturing frames", async () => {
    const { img, fire } = fakeImage({ complete: false });
    const { messages, start, cancel } = installStubs({ image: img });
    start();
    // Not complete yet: the pipeline holds off on frame capture instead of
    // silently recording without the visual.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(0);

    img.complete = true;
    img.naturalWidth = 5;
    fire("load");
    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoFrame")).toBe(true));
    cancel();
  });

  it("fails loud when a loading workspace image errors", async () => {
    const { img, fire } = fakeImage({ complete: false, src: "http://127.0.0.1:9999/files/img-1/gone.png" });
    const { messages, start } = installStubs({ image: img });
    start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fire("error");

    await vi.waitFor(() => expect(messages.some((m) => m.type === "mobileAgentVideoError")).toBe(true));
    const error = messages.find((m) => m.type === "mobileAgentVideoError");
    expect(error?.message).toMatch(/scene image could not be decoded/);
    expect(error?.message).toContain("gone.png");
  });

  it("prepares the next frame while the current one awaits native ack", async () => {
    const events = new Map<string, () => void>();
    const seeks: number[] = [];
    let time = 0.5;
    let finishSeek: (() => void) | undefined;
    const video = {
      duration: 1, readyState: 2, seeking: false, loop: false,
      pause() {},
      get currentTime() { return time; },
      set currentTime(value: number) {
        time = value;
        seeks.push(value);
        video.seeking = true;
        finishSeek = () => { video.seeking = false; events.get("seeked")?.(); };
      },
      addEventListener(name: string, listener: () => void) { events.set(name, listener); },
      removeEventListener(name: string) { events.delete(name); },
    };
    const { messages, start, consume, cancel } = installStubs({ video, autoConsume: false });
    start();
    await vi.waitFor(() => expect(finishSeek).toBeDefined());
    finishSeek!(); // Frame 0 seek done -> frame 0 posts, still unacked.
    await vi.waitFor(() => expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(1));
    // Frame 0 is unacknowledged, yet the pipeline must already seek frame 1.
    await vi.waitFor(() => expect(seeks).toEqual([0, 0.2]));
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(1);
    const first = messages.find((m) => m.type === "mobileAgentVideoFrame")!;
    consume(Number(first.requestId)); // Ack frame 0.
    finishSeek!(); // Frame 1 seek done -> posts immediately, already prepared.
    await vi.waitFor(() => expect(messages.filter((m) => m.type === "mobileAgentVideoFrame")).toHaveLength(2));
    expect(messages.filter((m) => m.type === "mobileAgentVideoFrame").map((m) => m.index)).toEqual([0, 1]);
    cancel();
    finishSeek?.(); // Release any frame-2 seek started before cancellation.
  });
});

describe("VIDEO_EXPORT_SCRIPT shots", () => {
  it("renders the shot that owns each time and skips the top-level render", async () => {
    const a: number[] = [];
    const b: number[] = [];
    const top: number[] = [];
    const shotA = function shotA(t: number) { a.push(t); };
    const shotB = function shotB(t: number) { b.push(t); };
    const { messages, start } = installStubs({
      shots: [
        { id: "a", start: 0, end: 0.5, render: shotA },
        { id: "b", start: 0.5, end: 1, render: shotB },
      ],
      render: () => { top.push(1); },
      documentHtml: `<script>${shotA.toString()}${shotB.toString()}</script>`,
    });

    start();
    await vi.waitFor(() =>
      expect(messages.some((m) => m.type === "mobileAgentVideoDone")).toBe(true),
    );

    expect(top).toHaveLength(0);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every((t) => t < 0.5)).toBe(true);
    expect(b.every((t) => t >= 0.5)).toBe(true);
    expect(a.length + b.length).toBe(5);
  });

  it("fingerprints shots independently and shared code together", () => {
    const a1 = function shotA(t: number) { void t; /* one */ };
    const a2 = function shotA(t: number) { void t; /* two */ };
    const b = function shotB(t: number) { void t; /* fixed */ };
    const { messages, probe } = installStubs({
      shots: [
        { id: "a", start: 0, end: 0.5, render: a1 },
        { id: "b", start: 0.5, end: 1, render: b },
      ],
      documentHtml: `<script>${a1.toString()}${b.toString()}</script>`,
    });

    probe();
    const first = messages.find((m) => m.type === "mobileAgentVideoPlan")!;
    const planShots = (message: Posted) =>
      message.shots as { id: string; hash: string }[];
    expect(planShots(first)).toHaveLength(2);

    // Edit only shot A: its hash moves, the shared code and shot B do not.
    const windowRef = (globalThis as unknown as {
      window: { MOBILE_AGENT_VIDEO: { shots: { render: unknown }[] } };
    }).window;
    windowRef.MOBILE_AGENT_VIDEO.shots[0].render = a2;
    (globalThis as unknown as { document: { documentElement: { outerHTML: string } } })
      .document.documentElement.outerHTML = `<script>${a2.toString()}${b.toString()}</script>`;

    probe();
    const second = messages.filter((m) => m.type === "mobileAgentVideoPlan")[1];

    expect(second.sharedHash).toBe(first.sharedHash);
    expect(planShots(second)[0].hash).not.toBe(planShots(first)[0].hash);
    expect(planShots(second)[1].hash).toBe(planShots(first)[1].hash);
  });
});
