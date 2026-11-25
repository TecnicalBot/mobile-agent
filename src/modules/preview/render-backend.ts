import {
  probeVideoPlan,
  requestVideoRender,
  type VideoExportTimings,
  type VideoRenderPlan,
} from "@/modules/preview/video-render";

/**
 * A segment *producer*. Deliberately narrow: the segment cache always lives on
 * the device (`Paths.cache`), so a segment recorded by a remote box and
 * downloaded here is indistinguishable from a locally recorded one. Backends
 * never own storage, they only answer "here is the MP4 for [offset, length)".
 *
 * Adding a backend must not change segmentation, cache keys, or concat
 * semantics — those stay in `render-segments.ts`.
 */
export type RenderBackend = {
  /** Stable id, surfaced in diagnostics only. Never part of a cache key. */
  id: string;
  label: string;
  kind: "device" | "remote";
  /**
   * How many `renderSegment` calls this backend can run at once. The device is
   * 1 (one hidden WebView, one encoder); a remote box may be 4–8.
   */
  concurrency: number;
  /** False when the target cannot answer a plan probe (falls back to legacy). */
  supportsProbe: boolean;
  /** What the target can actually encode. Remote backends must report this. */
  capabilities?(): Promise<RenderCapabilities>;
  /**
   * The codec/resolution profile this backend emits. `null` means "the caller
   * has no plan yet" (legacy scenes are rendered without a probe); the id must
   * still be stable and backend-specific, so footage never crosses profiles.
   */
  profileFor(plan: Pick<VideoRenderPlan, "width" | "height" | "fps"> | null): RenderProfile;
  probe(documentHtml: string, options?: { signal?: AbortSignal }): Promise<VideoRenderPlan>;
  renderSegment(request: SegmentRequest): Promise<SegmentArtifact>;
  /** Joins already-local segment files. May be device-native or ffmpeg. */
  concat(uris: string[], outUri: string): Promise<void>;
};

/**
 * Segments are interchangeable only inside one profile. Two runs of the same
 * scene on different profiles must never share footage: concat sample-copies
 * under the first segment's SPS/PPS, so a mixed set fails late and loudly.
 */
export type RenderProfile = {
  /**
   * Cache namespace suffix, e.g. `h264-nvenc-1080x1920-30-yuv420p`. The encoder
   * is part of the id on purpose: a GPU encode and a CPU encode of the same
   * scene are not joinable.
   */
  id: string;
  width: number;
  height: number;
  fps: number;
  codec: "h264" | "hevc";
  pixelFormat: "yuv420p";
  bitrateKbps: number;
  /** Concrete encoder, e.g. `h264_nvenc`, `h264_videotoolbox`, `mediacodec`. */
  encoder: string;
  /** True when `encoder` is hardware-accelerated. */
  hardware: boolean;
};

/**
 * What a render target reports before it is trusted with work.
 *
 * "Use the GPU" cannot be asserted from the app: the app ships HTML, the box
 * picks an encoder. So the target declares its encoders and the app refuses to
 * route work to a target whose best option is software (see
 * {@link requireHardwareEncoding}).
 */
export type RenderCapabilities = {
  /** ffmpeg encoder names the target can actually open, preferred first. */
  encoders: string[];
  /** First usable encoder, or null when the target can encode nothing. */
  preferred: string | null;
  /** True when at least one entry in `encoders` is hardware-accelerated. */
  hardware: boolean;
  /** Null on a CPU-only box. */
  gpu?: { vendor: string; name: string; driver?: string };
  /**
   * Whether Chromium rasterizes the scene canvas on the GPU. Canvas 2D falls
   * back to CPU raster silently, so this is reported, not assumed.
   */
  canvas: "gpu" | "cpu";
};

/** Encoders that run on fixed-function silicon rather than the CPU. */
export const HARDWARE_ENCODERS = new Set([
  "h264_nvenc",
  "hevc_nvenc",
  "av1_nvenc",
  "h264_qsv",
  "hevc_qsv",
  "av1_qsv",
  "h264_amf",
  "hevc_amf",
  "h264_vaapi",
  "hevc_vaapi",
  "h264_videotoolbox",
  "hevc_videotoolbox",
  "h264_v4l2m2m",
  "h264_mediacodec",
]);

export function isHardwareEncoder(encoder: string): boolean {
  return HARDWARE_ENCODERS.has(encoder);
}

/**
 * Picks a hardware encoder or throws. Call this before the first segment of a
 * remote run so a CPU-only box fails in one second instead of burning minutes
 * of x264 time — and so the message says what to fix.
 */
export function requireHardwareEncoding(capabilities: RenderCapabilities): string {
  const encoder = capabilities.encoders.find(isHardwareEncoder);
  if (encoder) return encoder;

  const seen = capabilities.encoders.length > 0 ? capabilities.encoders.join(", ") : "none";
  throw new Error(
    `The render target reports no hardware encoder (available: ${seen}). ` +
      `Rendering there would run on the CPU — slower than this device and no cheaper. ` +
      `Fix the target (docs/remote-render.md §GPU) or switch back to on-device rendering.`,
  );
}

export type SegmentRequest = {
  documentHtml: string;
  /** Whole-timeline length; used for progress math only. */
  duration?: number;
  /** Omit for a single-pass render of the whole contract. */
  segment?: { offset: number; length: number };
  /** Where this segment sits in the overall 0–1 progress bar. */
  progress?: { base: number; span: number };
  /** Encoder recorded by already-cached segments of this output. */
  pinnedEncoder?: string;
  conversationId?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
};

export type SegmentArtifact = {
  /** `file://` URI of the finished segment, already on the device. */
  uri: string;
  /** Producer codec string, e.g. `c2.samsung.avc.encoder` or `h264_nvenc`. */
  encoder?: string;
  hasAudio: boolean;
  audioWarnings: string[];
  perfWarnings?: string[];
  visualWarnings?: string[];
  timings?: VideoExportTimings;
};

export function profileIdFor(input: {
  encoder: string;
  width: number;
  height: number;
  fps: number;
  codec?: RenderProfile["codec"];
  pixelFormat?: RenderProfile["pixelFormat"];
}): string {
  const pixelFormat = input.pixelFormat ?? "yuv420p";
  // The encoder name already implies the codec (`h264_nvenc` vs `hevc_nvenc`),
  // so it is not repeated. Dimensions are unknown for legacy, unprobed scenes.
  const dims =
    input.width > 0 && input.height > 0 && input.fps > 0
      ? `${input.width}x${input.height}-${Math.round(input.fps)}`
      : "unknown";
  return `${input.encoder}-${dims}-${pixelFormat}`;
}

/** `file://` URIs -> plain paths for the native concatenator. */
function stripScheme(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

/**
 * Join local segment files with the native module. Shared by every backend:
 * segments always live on the device by the time concat runs, so a remote
 * backend still joins them here rather than uploading them back.
 */
export async function concatDeviceSegments(
  uris: string[],
  outUri: string,
): Promise<void> {
  const { getHtmlVideoExportModule } = await import("html-video-export");
  const module = getHtmlVideoExportModule();
  if (!module || typeof module.concatSegments !== "function") {
    throw new Error("Segmented rendering needs the video export module (concatSegments).");
  }
  await module.concatSegments(uris.map(stripScheme), stripScheme(outUri));
}

/**
 * The current on-device pipeline behind the backend shape. Behaviour is
 * identical to calling `requestVideoRender` directly: one WebView, one job at
 * a time, MediaCodec, native concat.
 *
 * The device is already hardware-encoded (MediaCodec), so it satisfies the
 * hardware requirement without any configuration.
 */
export function createDeviceRenderBackend(): RenderBackend {
  return {
    id: "device",
    label: "This device",
    kind: "device",
    concurrency: 1,
    supportsProbe: true,
    capabilities: async () => ({
      encoders: ["h264_mediacodec"],
      preferred: "h264_mediacodec",
      hardware: true,
      canvas: "gpu",
    }),
    profileFor: (plan) => {
      const encoder = "h264_mediacodec";
      return {
        id: profileIdFor({ encoder, ...(plan ?? { width: 0, height: 0, fps: 0 }) }),
        width: plan?.width ?? 0,
        height: plan?.height ?? 0,
        fps: plan?.fps ?? 0,
        codec: "h264",
        pixelFormat: "yuv420p",
        // The native muxer picks its own bitrate; this is descriptive only.
        bitrateKbps: 0,
        encoder,
        hardware: true,
      };
    },
    probe: (documentHtml, options) => probeVideoPlan(documentHtml, options),
    renderSegment: async (request) => {
      const result = await requestVideoRender(request.documentHtml, {
        conversationId: request.conversationId,
        signal: request.signal,
        onProgress: request.onProgress,
        segment: request.segment,
        progressBase: request.progress?.base,
        progressSpan: request.progress?.span,
        pinnedEncoder: request.pinnedEncoder,
      });
      return {
        uri: result.uri,
        encoder: result.encoder,
        hasAudio: result.hasAudio,
        audioWarnings: result.audioWarnings,
        perfWarnings: result.perfWarnings,
        visualWarnings: result.visualWarnings,
        timings: result.timings,
      };
    },
    concat: async (uris, outUri) => {
      await concatDeviceSegments(uris, outUri);
    },
  };
}
