import type { WebViewMessageEvent } from "react-native-webview";

import type { HtmlVideoExportNativeModule } from "html-video-export";

/**
 * Messages posted by the recorder script embedded in the preview document
 * (see video-recorder.ts). They arrive after the page's own download messages
 * through the same WebView `onMessage` channel.
 */
export type VideoExportConfigMessage = {
  type: "mobileAgentVideoConfig";
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  duration: number;
};

/**
 * One declared scene shot (see `MOBILE_AGENT_VIDEO.shots`). `hash` covers the
 * shot's id, its exact time window, and its render source — never the shared
 * scene code — so an edit to one shot invalidates only that shot's footage.
 */
export type VideoExportShotPlan = {
  id: string;
  start: number;
  end: number;
  hash: string;
};

/**
 * Probe reply: the contract's timing plus the per-shot fingerprints used to
 * decide which cached segments can be reused. Posted before any recording so
 * the renderer can plan segments instead of re-encoding the whole timeline.
 */
export type VideoExportPlanMessage = {
  type: "mobileAgentVideoPlan";
  duration: number;
  fps: number;
  width: number;
  height: number;
  /**
   * Fingerprint of the document with every shot's render source removed: the
   * top-level render, helpers, inline assets, audio/clip references, and the
   * audio schedule. Any change invalidates every cached segment (shared code
   * may affect any frame).
   */
  sharedHash: string;
  shots: VideoExportShotPlan[];
};

export type VideoExportMessage =
  | VideoExportConfigMessage
  | VideoExportPlanMessage
  | { type: "mobileAgentVideoCsd"; spsHex: string; ppsHex: string }
  | {
      type: "mobileAgentVideoEncodedChunk";
      index: number;
      frameCount: number;
      keyFrame: boolean;
      timestamp: number;
      base64: string;
    }
  | { type: "mobileAgentVideoFrame"; index: number; frameCount: number; base64: string; requestId?: number }
  | {
      type: "mobileAgentVideoAudioConfig";
      sampleRate: number;
      channels: number;
      encoding?: "aac" | "pcm16";
    }
  | { type: "mobileAgentVideoAudioChunk"; pts: number; base64: string }
  | { type: "mobileAgentVideoAudioPcmChunk"; pts: number; base64: string; requestId?: number }
  | { type: "mobileAgentVideoAudioUnsupported"; reason?: string }
  | { type: "mobileAgentVideoAudioWarning"; reason?: string }
  | {
      type: "mobileAgentVideoDone";
      emitted?: number;
      timings?: VideoExportTimings;
      /** One-time clip-mapping diagnostics gathered during the run. */
      visualWarnings?: unknown;
    }
  | { type: "mobileAgentVideoUnsupported" }
  | { type: "mobileAgentVideoError"; message: string };

/**
 * Per-stage wall-clock cost of the export for one segment. The per-frame
 * stages (page seek/render, JPEG capture, native encoder ack) are measured in
 * the recording page; the fixed-cost fields are measured by whichever layer
 * owns them — the page for audio prep, the host for boot. Instrumentation
 * only — the goal is to see which stage a slow export belongs to, never to
 * gate on it.
 */
export type VideoExportTimings = {
  frames: number;
  prepareAvgMs: number;
  prepareMaxMs: number;
  captureAvgMs: number;
  captureMaxMs: number;
  bridgeAvgMs: number;
  bridgeMaxMs: number;
  /** Page: soundtrack prep (fetch + decode + offline mix) before frame 1; 0 when silent. */
  audioPrepMs?: number;
  /** Host: job start → WebView load end (document prep + asset server + page parse). */
  pageLoadMs?: number;
  /** Host: job start → first frame message arrived at the bridge; includes page load. */
  firstFrameMs?: number;
};

export type VideoExportResult = {
  uri: string;
  sizeBytes: number;
  /** True when the muxer wrote at least one audio sample. */
  hasAudio: boolean;
  /** Last muxed audio timestamp in microseconds (0 when silent). */
  audioDurationUs: number;
  /** Non-fatal audio notes (skipped cues, blocked playback, ...). */
  audioWarnings: string[];
  /** Device codec that encoded the video, e.g. `c2.samsung.avc.encoder`. */
  encoder?: string;
  /** One-time clip-mapping diagnostics gathered during the run. */
  visualWarnings?: string[];
  /** Per-stage timing summary, when the page reported it. */
  timings?: VideoExportTimings;
  /** Non-fatal performance notes derived from the timings. */
  perfWarnings?: string[];
};

/**
 * Turns the page's timing summary into actionable notes. The only broken
 * promise an export can make is real-time capture, so a warning fires when the
 * per-frame work (seek/render + capture + native ack) exceeds the frame budget
 * by a clear margin — not on transient spikes.
 */
export function summarizeExportTimings(
  timings: VideoExportTimings,
  fps: number,
): string[] {
  if (!Number.isFinite(timings.frames) || timings.frames < 60) return [];
  const budget =
    Number.isFinite(fps) && fps > 0 ? 1000 / fps : 1000 / 30;
  const total =
    timings.prepareAvgMs + timings.captureAvgMs + timings.bridgeAvgMs;
  if (!Number.isFinite(total) || total <= budget * 1.25) return [];
  const notes: string[] = [];
  const stages: [string, number][] = [
    ["scene seek/render", timings.prepareAvgMs],
    ["canvas JPEG capture", timings.captureAvgMs],
    ["native encoder handoff", timings.bridgeAvgMs],
  ];
  for (const [label, value] of stages) {
    if (value > budget * 0.5) {
      notes.push(
        `Slow render: ${label} averaged ${Math.round(value)} ms/frame against a ${Math.round(budget)} ms budget (${timings.frames} frames measured).`,
      );
    }
  }
  if (notes.length === 0) {
    notes.push(
      `Slow render: per-frame work averaged ${Math.round(total)} ms against a ${Math.round(budget)} ms budget, so the export ran longer than the video.`,
    );
  }
  return notes;
}

export function isVideoExportMessage(value: unknown): value is VideoExportMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("mobileAgentVideo");
}

export type VideoExportControllerOptions = {
  outputPath: string;
  module: HtmlVideoExportNativeModule;
  onProgress: (progress: number) => void;
  onFinishing: () => void;
  onResult: (result: VideoExportResult) => void | Promise<void>;
  onError: (message: string, kind?: "unsupported") => void;
  onConfig?: (config: VideoExportConfigMessage) => void;
  /** Releases the page's bounded producer only after native consumed the data. */
  onConsumed?: (requestId: number) => void;
  /**
   * Codec that the segments of this output video were already encoded with
   * (from the resume sidecars). Passed to `beginFrames` so a resumed run
   * never switches encoders mid-video — SegmentConcat sample-copies every
   * segment under segment 1's SPS/PPS, so a switch corrupts the output.
   */
  pinnedEncoder?: string;
};

type VideoExportSession = "idle" | "recording" | "finishing" | "done" | "failed";

/**
 * Drives the native video export from WebView messages.
 *
 * Messages are processed through a promise chain so ordering is preserved even
 * when the native calls overlap the WebView's postMessage stream. The chain
 * acknowledges data only after native has consumed it. The page waits for
 * these acknowledgements, so no frames need to be dropped under load.
 */
export class VideoExportController {
  private chain: Promise<void> = Promise.resolve();
  private session: VideoExportSession = "idle";
  private config: VideoExportConfigMessage | null = null;
  private audioFormat: {
    sampleRate: number;
    channels: number;
    encoding: "aac" | "pcm16";
  } | null = null;
  private audioWarnings: string[] = [];
  private lastProgress = 0;
  private queued = 0;

  private readonly module: HtmlVideoExportNativeModule;
  private readonly outputPath: string;
  private readonly onProgress: (progress: number) => void;
  private readonly onFinishing: () => void;
  private readonly onResult: VideoExportControllerOptions["onResult"];
  private readonly onError: VideoExportControllerOptions["onError"];
  private readonly onConfig?: (config: VideoExportConfigMessage) => void;
  private readonly onConsumed?: (requestId: number) => void;
  private readonly pinnedEncoder?: string;

  constructor(options: VideoExportControllerOptions) {
    this.module = options.module;
    this.outputPath = options.outputPath;
    this.onProgress = options.onProgress;
    this.onFinishing = options.onFinishing;
    this.onResult = options.onResult;
    this.onError = options.onError;
    this.onConfig = options.onConfig;
    this.onConsumed = options.onConsumed;
    this.pinnedEncoder = options.pinnedEncoder;
  }

  /** True once the page posted its export config (recorder started). */
  hasConfig(): boolean {
    return this.config !== null;
  }

  /** True once the native session is recording frames. */
  isRecording(): boolean {
    return this.session === "recording";
  }

  handleMessage(event: WebViewMessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isVideoExportMessage(data)) return;
    this.enqueue(data);
  }

  /** Stops the in-flight export (also called when the preview is dismissed). */
  cancel(): Promise<void> {
    this.session = "failed";
    return this.chain.then(async () => {
      try {
        await this.module.cancel();
      } catch {
        // The native export may already have been torn down.
      }
    });
  }

  /** Resolves once every queued message has been processed. */
  whenIdle(): Promise<void> {
    return this.chain;
  }

  private enqueue(message: VideoExportMessage): void {
    this.queued += 1;
    this.chain = this.chain
      .then(() => this.process(message))
      .catch((error) => {
        this.fail(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        this.queued -= 1;
      });
  }

  private async process(message: VideoExportMessage): Promise<void> {
    switch (message.type) {
      case "mobileAgentVideoConfig": {
        this.config = message;
        try {
          this.onConfig?.(message);
        } catch {
          // Progress callbacks must never break the export chain.
        }
        return;
      }
      case "mobileAgentVideoCsd": {
        const config = this.config;
        if (!config) throw new Error("Video export config was not received.");
        if (this.session === "recording") return;
        await this.configureAudio();
        await this.module.beginH264(
          this.outputPath,
          config.width,
          config.height,
          config.fps,
          config.frameCount,
          message.spsHex,
          message.ppsHex,
        );
        this.session = "recording";
        return;
      }
      case "mobileAgentVideoEncodedChunk": {
        if (this.session === "failed" || this.session === "done") return;
        if (this.session !== "recording") {
          throw new Error("Encoded video arrived before the export started.");
        }
        await this.module.pushH264Chunk(
          message.keyFrame,
          Math.round(message.timestamp),
          message.base64,
        );
        this.reportProgress(message.index, message.frameCount);
        return;
      }
      case "mobileAgentVideoFrame": {
        if (this.session === "failed" || this.session === "done") return;
        const config = this.config;
        if (!config) throw new Error("Video export config was not received.");
        if (this.session !== "recording") {
          await this.configureAudio();
          await this.module.beginFrames(
            this.outputPath,
            config.width,
            config.height,
            config.fps,
            config.frameCount,
            // Resumed segments recorded their encoder; staying on it keeps one
            // SPS/PPS across every segment of this output video.
            this.pinnedEncoder ?? null,
          );
          this.session = "recording";
        }
        await this.module.pushJpegFrame(message.index, message.base64);
        this.reportProgress(message.index + 1, message.frameCount);
        if (message.requestId !== undefined) this.onConsumed?.(message.requestId);
        return;
      }
      case "mobileAgentVideoDone": {
        if (this.session === "done" || this.session === "failed") return;
        this.session = "finishing";
        this.onFinishing();
        const result = await this.module.finish();
        this.session = "done";
        const audioDurationUs = Number(result.audioDurationUs) || 0;
        // A partial soundtrack is a silent-ish failure: the MP4 plays short
        // on sound with no other signal, so say so explicitly.
        if (
          this.audioFormat &&
          result.hasAudio &&
          this.config &&
          audioDurationUs > 0 &&
          audioDurationUs < this.config.duration * 1_000_000 * 0.9
        ) {
          const captured = (audioDurationUs / 1_000_000).toFixed(1);
          const reason =
            `Only ${captured}s of audio was captured for a ${this.config.duration}s video. ` +
            `The soundtrack stops early; re-render to try again.`;
          this.audioWarnings.push(reason);
          console.warn(`[video-export] ${reason}`);
        }
        // Timing instrumentation: keep the raw numbers and surface outliers.
        const timings =
          message.timings && Number.isFinite(message.timings.frames)
            ? message.timings
            : undefined;
        await this.onResult({
          ...result,
          audioDurationUs,
          encoder: typeof result.encoder === "string" && result.encoder ? result.encoder : undefined,
          visualWarnings: Array.isArray(message.visualWarnings)
            ? message.visualWarnings.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          audioWarnings: this.audioWarnings,
          timings,
          perfWarnings: timings && this.config ? summarizeExportTimings(timings, this.config.fps) : [],
        });
        return;
      }
      case "mobileAgentVideoAudioConfig": {
        const sampleRate = Math.round(message.sampleRate);
        const channels = Math.round(message.channels);
        const encoding = message.encoding ?? "aac";
        if (
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0 ||
          !Number.isFinite(channels) ||
          channels <= 0 ||
          (encoding !== "aac" && encoding !== "pcm16")
        ) {
          throw new Error("Invalid audio configuration from the page.");
        }
        if (this.session !== "idle") {
          throw new Error("Audio configuration arrived after the export started.");
        }
        this.audioFormat = { sampleRate, channels, encoding };
        // PCM can arrive before the first video frame/CSD. Start its native
        // encoder now; encoded samples are buffered until the muxer exists.
        if (encoding === "pcm16") {
          await this.module.setAudioPcmFormat(sampleRate, channels);
        }
        return;
      }
      case "mobileAgentVideoAudioChunk": {
        if (this.session === "failed" || this.session === "done") return;
        if (!this.audioFormat) {
          throw new Error("Audio arrived before its configuration.");
        }
        if (this.audioFormat.encoding !== "aac") {
          throw new Error("AAC audio arrived on a PCM audio track.");
        }
        await this.module.pushAudioChunk(Math.round(message.pts), message.base64);
        return;
      }
      case "mobileAgentVideoAudioPcmChunk": {
        if (this.session === "failed" || this.session === "done") return;
        if (!this.audioFormat) {
          throw new Error("Audio arrived before its configuration.");
        }
        if (this.audioFormat.encoding !== "pcm16") {
          throw new Error("PCM audio arrived on an AAC audio track.");
        }
        await this.module.pushPcmChunk(Math.round(message.pts), message.base64);
        if (message.requestId !== undefined) this.onConsumed?.(message.requestId);
        return;
      }
      case "mobileAgentVideoAudioUnsupported":
      case "mobileAgentVideoAudioWarning": {
        const reason = message.reason || "Audio was skipped.";
        this.audioWarnings.push(reason);
        console.warn(`[video-export] ${reason}`);
        return;
      }
      case "mobileAgentVideoUnsupported": {
        this.fail(
          "This HTML cannot be exported as a video: it needs a canvas and a window.MOBILE_AGENT_VIDEO contract. Ask the agent to make a recordable video.",
          "unsupported",
        );
        return;
      }
      case "mobileAgentVideoError": {
        this.fail(message.message || "Video export failed.");
        return;
      }
    }
  }

  private async configureAudio(): Promise<void> {
    if (!this.audioFormat) return;
    const { channels, encoding, sampleRate } = this.audioFormat;
    if (encoding === "pcm16") {
      return;
    } else {
      await this.module.setAudioFormat(sampleRate, channels);
    }
  }

  private reportProgress(index: number, frameCount: number): void {
    const progress = frameCount > 0 ? Math.min(1, index / frameCount) : 0;
    if (progress - this.lastProgress >= 0.01 || progress >= 1) {
      this.lastProgress = progress;
      this.onProgress(progress);
    }
  }

  private fail(message: string, kind?: "unsupported"): void {
    if (this.session === "failed" || this.session === "done") return;
    this.session = "failed";
    void this.module.cancel().catch(() => {});
    if (kind === undefined) this.onError(message);
    else this.onError(message, kind);
  }
}
