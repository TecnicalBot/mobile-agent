import { afterEach, describe, expect, it, vi } from "vitest";

import { VIDEO_EXPORT_SCRIPT } from "@/modules/preview/video-recorder";

const { VIDEO_MIX_SCRIPT } = await import("@/modules/preview/video-mix-script");

type Posted = { type: string; [key: string]: unknown };

type RecordedOsc = { startCalls: number[] };
type RecordedSrc = { startCalls: unknown[][] };

function installMixStubs(options: {
  contract?: unknown;
  renderFill?: number;
  fetchImpl?: () => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
  withEngine?: boolean;
} = {}) {
  const g = globalThis as Record<string, unknown>;
  const messages: Posted[] = [];
  const oscillators: RecordedOsc[] = [];
  const sources: RecordedSrc[] = [];
  const renderLengths: number[] = [];
  let decodeCalls = 0;
  const realFetch = g.fetch;

  const fill = options.renderFill ?? 0.4;

  const gainStub = () => ({
    gain: {
      value: 1,
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    },
    connect: () => {},
  });

  class FakeOfflineAudioContext {
    sampleRate = 48000;
    frameLength = 1;
    destination = {};
    __mobileAgentNoise: unknown = null;
    constructor(_channels: number, length: number, rate: number) {
      this.frameLength = Math.max(1, length);
      if (rate > 0) this.sampleRate = rate;
    }
    createGain() {
      return gainStub();
    }
    createOscillator() {
      const startCalls: number[] = [];
      const node: RecordedOsc & {
        type: string;
        frequency: object;
        connect: () => void;
        start: (t: number) => void;
        stop: () => void;
      } = {
        type: "sine",
        frequency: {
          value: 440,
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        startCalls,
        connect: () => {},
        start: (t: number) => {
          startCalls.push(t);
        },
        stop: () => {},
      };
      oscillators.push(node);
      return node;
    }
    createBufferSource() {
      const startCalls: unknown[][] = [];
      const node: RecordedSrc & {
        buffer: unknown;
        loop: boolean;
        connect: () => void;
        start: (...args: unknown[]) => void;
        stop: () => void;
      } = {
        buffer: null,
        loop: false,
        startCalls,
        connect: () => {},
        start: (...args: unknown[]) => {
          startCalls.push(args);
        },
        stop: () => {},
      };
      sources.push(node);
      return node;
    }
    createBiquadFilter() {
      return {
        type: "lowpass",
        frequency: {
          value: 800,
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        Q: { value: 1 },
        connect: () => {},
      };
    }
    createBuffer(channels: number, length: number, rate: number) {
      const channelData: Float32Array[] = [];
      for (let c = 0; c < channels; c += 1) channelData.push(new Float32Array(length));
      return {
        length,
        sampleRate: rate,
        numberOfChannels: channels,
        getChannelData: (ch: number) => channelData[ch],
      };
    }
    createConvolver() {
      return { buffer: null, connect: () => {} };
    }
    createDelay() {
      return { delayTime: { value: 0 }, connect: () => {} };
    }
    decodeAudioData() {
      decodeCalls += 1;
      return Promise.resolve({
        numberOfChannels: 1,
        sampleRate: 48000,
        duration: 1,
        getChannelData: () => new Float32Array(8).fill(0.25),
      });
    }
    startRendering() {
      renderLengths.push(this.frameLength);
      const renderedData = [
        new Float32Array(this.frameLength).fill(fill),
        new Float32Array(this.frameLength).fill(fill),
      ];
      return Promise.resolve({
        numberOfChannels: 2,
        sampleRate: this.sampleRate,
        getChannelData: (ch: number) => renderedData[ch],
      });
    }
  }

  g.window = {
    MOBILE_AGENT_VIDEO: options.contract ?? null,
    ReactNativeWebView: {
      postMessage: (data: string) => {
        messages.push(JSON.parse(data));
      },
    },
  };
  g.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    images: [],
  };
  g.OfflineAudioContext = FakeOfflineAudioContext;
  g.fetch = options.fetchImpl ?? (async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }));

  if (options.withEngine !== false) {
    new Function(VIDEO_EXPORT_SCRIPT)();
  }
  new Function(VIDEO_MIX_SCRIPT)();

  const w = g.window as Record<string, (duration: number) => void>;
  return {
    messages,
    oscillators,
    sources,
    renderLengths,
    decodeCalls: () => decodeCalls,
    restoreFetch: () => {
      g.fetch = realFetch;
    },
    start: (duration: number) => w.__startMobileAgentMixCheck(duration),
    cancel: () =>
      (w as Record<string, () => void>).__cancelMobileAgentMixCheck(),
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.OfflineAudioContext;
  vi.unstubAllGlobals();
});

async function waitForMix(messages: Posted[]) {
  await vi.waitFor(
    () => {
      expect(
        messages.some(
          (m) => m.type === "mobileAgentMixDone" || m.type === "mobileAgentMixError",
        ),
      ).toBe(true);
    },
    { timeout: 4000 },
  );
}

function doneResult(messages: Posted[]) {
  return messages.find((m) => m.type === "mobileAgentMixDone") as
    | { stats: Record<string, unknown>; warnings: string[] }
    | undefined;
}

const TONE_AND_FILE = {
  duration: 2,
  render: () => {},
  audio: {
    tracks: [
      { synth: { kind: "tone", freq: 440 }, start: 0, duration: 2, volume: 0.5 },
      { file: "data:audio/wav;base64,QUJD", start: 0, duration: 1, volume: 0.8 },
    ],
  },
};

function longFileScene(duration: number) {
  return {
    duration,
    render: () => {},
    audio: {
      tracks: [
        { file: "data:audio/wav;base64,QUJD", start: 0, duration, volume: 0.8 },
      ],
    },
  };
}

describe("VIDEO_MIX_SCRIPT", () => {
  it("posts exact stats for a known render with decoded files", async () => {
    const api = installMixStubs({ contract: TONE_AND_FILE });
    try {
      api.start(2);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      expect(done?.stats).toMatchObject({
        clipped: false,
        clippedRanges: [],
        quietRanges: [],
        duckedRanges: [],
        duration: 2,
      });
      expect((done?.stats as { peak: number }).peak).toBeCloseTo(0.4, 6);
      expect((done?.stats as { rms: number }).rms).toBeCloseTo(0.4, 6);
      expect(done?.warnings).toEqual([]);
      // File decoded once; tone pluck + file source scheduled offline.
      expect(api.decodeCalls()).toBe(1);
      expect(api.oscillators).toHaveLength(1);
      expect(api.sources).toHaveLength(1);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("echoes ducked ranges from the schedule", async () => {
    const api = installMixStubs({
      contract: {
        duration: 4,
        render: () => {},
        audio: {
          tracks: [
            {
              synth: { kind: "tone", freq: 220 },
              start: 0,
              duration: 4,
              duckUnder: [{ start: 1, end: 2 }],
              duckAmount: 0.25,
            },
          ],
        },
      },
    });
    try {
      api.start(4);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      expect(done?.stats).toMatchObject({
        duckedRanges: [{ start: 1, end: 2, level: 0.25 }],
      });
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("detects clipping on a hot render", async () => {
    const api = installMixStubs({ contract: TONE_AND_FILE, renderFill: 1.2 });
    try {
      api.start(2);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      expect(done?.stats).toMatchObject({
        clipped: true,
        clippedRanges: [{ start: 0, end: 2 }],
      });
      expect((done?.stats as { peak: number }).peak).toBeCloseTo(1.2, 6);
      expect((done?.stats as { rms: number }).rms).toBeCloseTo(1.2, 6);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("detects near-silence per one-second window", async () => {
    const api = installMixStubs({ contract: TONE_AND_FILE, renderFill: 0.01 });
    try {
      api.start(2);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      expect(done?.stats).toMatchObject({
        quietRanges: [
          { start: 0, end: 1 },
          { start: 1, end: 2 },
        ],
      });
      expect((done?.stats as { peak: number }).peak).toBeCloseTo(0.01, 6);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("checks long timelines in bounded windows and merges clipping across seams", async () => {
    const api = installMixStubs({ contract: longFileScene(100), renderFill: 1.2 });
    try {
      api.start(100);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      // One decode for the whole check, one bounded render per 45 s window.
      expect(api.decodeCalls()).toBe(1);
      expect(api.renderLengths).toEqual([45 * 48000, 45 * 48000, 10 * 48000]);
      // The file cue is scheduled once per window, not once globally.
      expect(api.sources).toHaveLength(3);
      expect(done?.stats).toMatchObject({
        duration: 100,
        clipped: true,
        clippedRanges: [{ start: 0, end: 100 }],
      });
      expect((done?.stats as { peak: number }).peak).toBeCloseTo(1.2, 6);
      expect((done?.stats as { rms: number }).rms).toBeCloseTo(1.2, 6);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("reports quiet ranges in absolute time across window boundaries", async () => {
    const api = installMixStubs({ contract: longFileScene(50), renderFill: 0.01 });
    try {
      api.start(50);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      const quiet = done?.stats.quietRanges as { start: number; end: number }[];
      expect(quiet).toHaveLength(50);
      expect(quiet[0]).toEqual({ start: 0, end: 1 });
      expect(quiet[44]).toEqual({ start: 44, end: 45 });
      expect(quiet[45]).toEqual({ start: 45, end: 46 });
      expect(quiet.at(-1)).toEqual({ start: 49, end: 50 });
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("warns and continues when a file will not decode", async () => {
    const api = installMixStubs({
      contract: TONE_AND_FILE,
      fetchImpl: async () => {
        throw new Error("nope");
      },
    });
    try {
      api.start(2);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      expect(done?.stats).not.toBeNull();
      expect(
        (done?.warnings ?? []).some((msg) => msg.includes("could not be decoded")),
      ).toBe(true);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("reports no schedule instead of failing", async () => {
    const api = installMixStubs({
      contract: { duration: 2, render: () => {} },
    });
    try {
      api.start(2);
      await waitForMix(api.messages);

      const done = doneResult(api.messages);
      expect(done?.stats).toBeNull();
      expect(
        (done?.warnings ?? []).some((msg) => msg.includes("no audio schedule")),
      ).toBe(true);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("errors clearly without the audio engine", async () => {
    const api = installMixStubs({ contract: TONE_AND_FILE, withEngine: false });
    try {
      api.start(2);
      await waitForMix(api.messages);

      expect(
        api.messages.some((m) => m.type === "mobileAgentMixError"),
      ).toBe(true);
    } finally {
      api.restoreFetch();
    }
  }, 10000);

  it("posts nothing after cancel", async () => {
    const api = installMixStubs({ contract: TONE_AND_FILE });
    try {
      api.start(2);
      api.cancel();
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(api.messages).toHaveLength(0);
    } finally {
      api.restoreFetch();
    }
  }, 10000);
});
