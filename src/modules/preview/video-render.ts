import type {
  VideoExportShotPlan,
  VideoExportTimings,
} from "@/modules/preview/video-export-messages";

export type { VideoExportShotPlan, VideoExportTimings };

/**
 * Longest scene the exporter accepts (contract `duration`, recorder and tool
 * schema). Previews and mix checks share the number so a check can never offer
 * a timeline the render would refuse.
 */
export const MAX_VIDEO_DURATION_SECONDS = 600;

/**
 * Tool-driven video rendering queue.
 *
 * The agent renders a video by calling the `renderVideo` tool, which hands the
 * self-contained HTML document to {@link requestVideoRender}. The promise stays
 * pending until the app-level {@link VideoRenderHost} (rendered in the root
 * layout) records the document in a hidden WebView and resolves it with the
 * finished MP4.
 *
 * There is no renderer in JS: the only thing that can record is the mounted
 * WebView adapter, so this module is just a hand-off queue with promises. It is
 * intentionally pure (no react-native imports) so it can be unit-tested in Node.
 */

export type VideoRenderResult = {
  /** Cache-directory `file://` URI of the finished MP4. */
  uri: string;
  sizeBytes: number;
  /** True when the muxer wrote at least one audio sample. */
  hasAudio: boolean;
  /** Non-fatal audio notes (skipped cues, blocked playback, ...). */
  audioWarnings: string[];
  /** One-time clip-mapping diagnostics gathered during the run. */
  visualWarnings?: string[];
  /** Device codec that encoded the video (empty for very old native builds). */
  encoder?: string;
  /** Per-stage timing summary, when the page reported one. */
  timings?: VideoExportTimings;
  /** Non-fatal performance notes derived from the timings. */
  perfWarnings?: string[];
};

/**
 * One transform keyframe of a declared editor layer. `t` is normalized to the
 * layer's own window (0 = layer start, 1 = layer end), matching Alight Motion.
 */
export type VideoLayerKeyframe = {
  t: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  opacity?: number;
};

/**
 * A non-video element declared as data alongside the canvas `render`. The
 * canvas still draws it; this list is what an editor project can rebuild as a
 * real text/image/shape layer instead of flattened pixels.
 */
export type VideoLayerPlan = {
  id: string;
  type: "text" | "image" | "shape";
  label: string;
  start: number;
  end: number;
  /** Box in canvas pixels, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Stacking order (higher is in front). */
  z: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  fill?: string;
  radius?: number;
  fileId?: string;
  fit?: "fill" | "fit";
  keys?: VideoLayerKeyframe[];
};

/** A declared `<video>` clip, used as an editable video layer on export. */
export type VideoClipLayerPlan = {
  id: string;
  label: string;
  start: number;
  end: number;
  /** Source position mapped to `start`, seconds. */
  from: number;
  fileId?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  opacity?: number;
  fit?: "fill" | "fit";
};

/**
 * The scene's timing plus per-shot fingerprints, read from the page before a
 * render. `shots` is empty for legacy scenes; callers then keep the old
 * whole-document resume behavior. `layers`/`clipLayers` are the optional
 * declarative composition an editor export can rebuild; absent means the
 * export falls back to one flattened layer per shot.
 */
export type VideoRenderPlan = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  sharedHash: string;
  shots: VideoExportShotPlan[];
  layers?: VideoLayerPlan[];
  clipLayers?: VideoClipLayerPlan[];
};

export type VideoRenderJob = {
  kind: "render";
  id: string;
  conversationId?: string;
  html: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** Segmented export: render [offset, offset + length) instead of the whole contract. */
  segment?: { offset: number; length: number };
  /**
   * Cumulative 0–1 progress mapping for the in-chat indicator: where this
   * render's work sits inside the whole video (`progressBase +
   * fraction * progressSpan`). Omitted for single-pass renders (0–1 as-is).
   */
  progressBase?: number;
  progressSpan?: number;
  /**
   * Codec recorded by already-rendered segments of this output video (their
   * sidecars). The host passes it through to `beginFrames` so a resumed
   * segmented export never mixes encoders — concat refuses segments with
   * different H.264 parameters. Omitted on fresh runs.
   */
  pinnedEncoder?: string;
  resolve: (result: VideoRenderResult) => void;
  reject: (error: Error) => void;
};

/**
 * Read-only job: loads the scene and asks the page for its plan. Runs through
 * the same one-at-a-time queue as renders (one WebView), so a probe can never
 * fight an export for the hidden host, and it captures no frames.
 */
export type VideoProbeJob = {
  kind: "probe";
  id: string;
  html: string;
  signal?: AbortSignal;
  resolve: (plan: VideoRenderPlan) => void;
  reject: (error: Error) => void;
};

export type VideoJob = VideoRenderJob | VideoProbeJob;

type VideoRenderListener = (job: VideoJob) => void;

const listeners = new Set<VideoRenderListener>();

let jobCounter = 0;

/** Live progress for the active render, consumed by the in-chat indicator. */
export type VideoRenderStatus = {
  /** Absent for manual/bridge exports, which must not label an arbitrary chat. */
  conversationId?: string;
  /** 0–1 recording progress. */
  progress: number;
  /** True once frames are done and the file is being finalized. */
  finishing: boolean;
};

let activeStatus: VideoRenderStatus | null = null;
const statusListeners = new Set<() => void>();

export function getVideoRenderStatus(): VideoRenderStatus | null {
  return activeStatus;
}

export function getVideoRenderStatusForConversation(
  conversationId: string,
): VideoRenderStatus | null {
  return activeStatus?.conversationId === conversationId ? activeStatus : null;
}

export function subscribeVideoRenderStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function setVideoRenderStatus(next: VideoRenderStatus | null): void {
  activeStatus = next;
  for (const listener of [...statusListeners]) {
    listener();
  }
}

/** Registers the host that actually performs renders. Returns an unsubscribe. */
export function subscribeVideoRender(
  listener: VideoRenderListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True when a mounted host can service render requests on this platform. Used to
 * fail fast with a helpful message instead of hanging forever.
 */
export function hasVideoRenderHost(): boolean {
  return listeners.size > 0;
}

function finiteNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates the declarative layer list a scene can ship for editor export.
 * This is deliberately forgiving: a malformed layer is dropped (the canvas
 * render is still the source of truth), never fatal to the whole plan.
 */
export function normalizeVideoLayers(
  value: unknown,
  duration: number,
): VideoLayerPlan[] {
  if (!Array.isArray(value)) return [];
  const layers: VideoLayerPlan[] = [];
  const alignments = new Set(["left", "center", "right"]);
  for (const entry of value.slice(0, 80)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const type = raw.type;
    if (type !== "text" && type !== "image" && type !== "shape") continue;
    const start = finiteNumber(raw.start);
    const end = finiteNumber(raw.end);
    const x = finiteNumber(raw.x) ?? 0;
    const y = finiteNumber(raw.y) ?? 0;
    const w = finiteNumber(raw.w);
    const h = finiteNumber(raw.h);
    if (start == null || end == null || end <= start) continue;
    if (w == null || h == null || w <= 0 || h <= 0) continue;
    const clippedStart = clampNumber(start, 0, duration);
    const clippedEnd = clampNumber(end, 0, duration);
    if (clippedEnd - clippedStart < 0.001) continue;
    if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) continue;
    if (w > 100_000 || h > 100_000) continue;

    const fileId =
      typeof raw.fileId === "string" && raw.fileId.trim()
        ? raw.fileId.trim().slice(0, 200)
        : undefined;
    if (type === "image" && !fileId) continue;

    const layer: VideoLayerPlan = {
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim().slice(0, 80)
          : `${type}-${layers.length + 1}`,
      type,
      label:
        typeof raw.label === "string" && raw.label.trim()
          ? raw.label.trim().slice(0, 120)
          : type === "text" && typeof raw.text === "string" && raw.text.trim()
            ? raw.text.trim().slice(0, 48)
            : `${type} ${layers.length + 1}`,
      start: clippedStart,
      end: clippedEnd,
      x,
      y,
      w,
      h,
      rotation: clampNumber(finiteNumber(raw.rotation) ?? 0, -36_000, 36_000),
      opacity: clampNumber(finiteNumber(raw.opacity) ?? 1, 0, 1),
      z: clampNumber(finiteNumber(raw.z) ?? layers.length + 1, -100, 100),
      ...(fileId ? { fileId } : {}),
      ...(raw.fit === "fill" || raw.fit === "fit" ? { fit: raw.fit } : {}),
    };

    if (type === "text") {
      const text = typeof raw.text === "string" ? raw.text.slice(0, 4_000) : "";
      if (!text.trim()) continue;
      layer.text = text;
      layer.fontSize = clampNumber(finiteNumber(raw.fontSize) ?? 48, 1, 2_000);
      layer.fontWeight = clampNumber(
        Math.round(finiteNumber(raw.fontWeight) ?? 400),
        100,
        900,
      );
      if (typeof raw.fontFamily === "string" && raw.fontFamily.trim()) {
        layer.fontFamily = raw.fontFamily.trim().slice(0, 120);
      }
      if (typeof raw.color === "string" && raw.color.trim()) {
        layer.color = raw.color.trim().slice(0, 64);
      }
      if (typeof raw.align === "string" && alignments.has(raw.align)) {
        layer.align = raw.align as VideoLayerPlan["align"];
      }
    } else if (type === "shape") {
      if (typeof raw.fill === "string" && raw.fill.trim()) {
        layer.fill = raw.fill.trim().slice(0, 64);
      }
      layer.radius = clampNumber(finiteNumber(raw.radius) ?? 0, 0, 100_000);
    }

    if (Array.isArray(raw.keys)) {
      const keys: VideoLayerKeyframe[] = [];
      for (const keyEntry of raw.keys.slice(0, 40)) {
        if (!keyEntry || typeof keyEntry !== "object") continue;
        const key = keyEntry as Record<string, unknown>;
        const t = finiteNumber(key.t);
        if (t == null) continue;
        const next: VideoLayerKeyframe = { t: clampNumber(t, 0, 1) };
        for (const field of [
          "x",
          "y",
          "w",
          "h",
          "rotation",
          "opacity",
        ] as const) {
          const value = finiteNumber(key[field]);
          if (value != null) next[field] = value;
        }
        keys.push(next);
      }
      keys.sort((a, b) => a.t - b.t);
      const deduped: VideoLayerKeyframe[] = [];
      for (const key of keys) {
        if (
          deduped.length > 0 &&
          Math.abs(key.t - deduped[deduped.length - 1].t) < 1e-6
        ) {
          deduped[deduped.length - 1] = key;
        } else {
          deduped.push(key);
        }
      }
      if (deduped.length > 1) layer.keys = deduped;
    }

    layers.push(layer);
  }
  return layers;
}

/** Validates the declarative `<video>` windows used as editable clip layers. */
export function normalizeVideoClipLayers(
  value: unknown,
  duration: number,
): VideoClipLayerPlan[] {
  if (!Array.isArray(value)) return [];
  const clips: VideoClipLayerPlan[] = [];
  for (const entry of value.slice(0, 60)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const start = finiteNumber(raw.start);
    const end = finiteNumber(raw.end);
    if (start == null || end == null || end <= start) continue;
    const clippedStart = clampNumber(start, 0, duration);
    const clippedEnd = clampNumber(end, 0, duration);
    if (clippedEnd - clippedStart < 0.001) continue;

    const rectProvided =
      raw.x !== undefined ||
      raw.y !== undefined ||
      raw.w !== undefined ||
      raw.h !== undefined;
    let rect: Pick<VideoClipLayerPlan, "x" | "y" | "w" | "h"> | null = null;
    if (rectProvided) {
      const x = finiteNumber(raw.x);
      const y = finiteNumber(raw.y);
      const w = finiteNumber(raw.w);
      const h = finiteNumber(raw.h);
      if (x == null || y == null || w == null || h == null) continue;
      if (w <= 0 || h <= 0 || w > 100_000 || h > 100_000) continue;
      rect = { x, y, w, h };
    }

    clips.push({
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim().slice(0, 80)
          : `clip-${clips.length + 1}`,
      label:
        typeof raw.label === "string" && raw.label.trim()
          ? raw.label.trim().slice(0, 120)
          : `clip ${clips.length + 1}`,
      start: clippedStart,
      end: clippedEnd,
      from: clampNumber(finiteNumber(raw.from) ?? 0, 0, 86_400),
      ...(typeof raw.fileId === "string" && raw.fileId.trim()
        ? { fileId: raw.fileId.trim().slice(0, 200) }
        : {}),
      ...(rect ?? {}),
      ...(raw.opacity !== undefined || raw.alpha !== undefined
        ? {
            opacity: clampNumber(
              finiteNumber(raw.opacity) ?? finiteNumber(raw.alpha) ?? 1,
              0,
              1,
            ),
          }
        : {}),
      ...(raw.fit === "fill" || raw.fit === "fit" ? { fit: raw.fit } : {}),
    });
  }
  return clips;
}

/**
 * Validates a plan posted by the page. The page is trusted scene code, but a
 * malformed plan must never reach the segmentation math (NaN windows, absurd
 * shot counts) — a probe is an optimization, so a bad plan is a hard failure
 * with a clear message rather than a silently wrong cache key.
 */
export function normalizeVideoPlan(value: unknown): VideoRenderPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const finite = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : null;
  const duration = finite(raw.duration);
  const fps = finite(raw.fps);
  const width = finite(raw.width);
  const height = finite(raw.height);
  const sharedHash =
    typeof raw.sharedHash === "string" ? raw.sharedHash.trim() : "";
  if (
    duration == null ||
    duration <= 0 ||
    duration > MAX_VIDEO_DURATION_SECONDS ||
    fps == null ||
    fps < 5 ||
    fps > 60 ||
    width == null ||
    width < 16 ||
    width > 1920 ||
    height == null ||
    height < 16 ||
    height > 1920 ||
    !sharedHash
  ) {
    return null;
  }
  const shots: VideoExportShotPlan[] = [];
  if (Array.isArray(raw.shots)) {
    for (const entry of raw.shots.slice(0, 200)) {
      if (!entry || typeof entry !== "object") continue;
      const shot = entry as Record<string, unknown>;
      const start = finite(shot.start);
      const end = finite(shot.end);
      const hash = typeof shot.hash === "string" ? shot.hash.trim() : "";
      if (start == null || end == null || end <= start || !hash) continue;
      const id =
        typeof shot.id === "string" && shot.id
          ? shot.id
          : `shot-${shots.length + 1}`;
      shots.push({ id, start, end, hash });
    }
  }
  shots.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    duration,
    fps,
    width,
    height,
    sharedHash,
    shots,
    layers: normalizeVideoLayers(raw.layers, duration),
    clipLayers: normalizeVideoClipLayers(raw.clipLayers, duration),
  };
}

/**
 * Requests an MP4 for a self-contained HTML document that implements the
 * `window.MOBILE_AGENT_VIDEO` contract. Resolves with the recorded file.
 */
export function requestVideoRender(
  html: string,
  options: {
    conversationId?: string;
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    segment?: { offset: number; length: number };
    /** See {@link VideoRenderJob.progressBase}. */
    progressBase?: number;
    /** See {@link VideoRenderJob.progressSpan}. */
    progressSpan?: number;
    /** See {@link VideoRenderJob.pinnedEncoder}. */
    pinnedEncoder?: string;
  } = {},
): Promise<VideoRenderResult> {
  return new Promise<VideoRenderResult>((resolve, reject) => {
    if (!html.includes("MOBILE_AGENT_VIDEO")) {
      reject(
        new Error(
          "The HTML does not implement the window.MOBILE_AGENT_VIDEO contract, so it cannot be recorded.",
        ),
      );
      return;
    }

    if (!hasVideoRenderHost()) {
      reject(
        new Error(
          "Video rendering is only available on Android builds that include the video export module.",
        ),
      );
      return;
    }

    if (options.signal?.aborted) {
      reject(new Error("Video render was cancelled."));
      return;
    }

    const job: VideoRenderJob = {
      kind: "render",
      id: `video-render-${++jobCounter}`,
      conversationId: options.conversationId,
      html,
      onProgress: options.onProgress,
      signal: options.signal,
      segment: options.segment,
      progressBase: options.progressBase,
      progressSpan: options.progressSpan,
      pinnedEncoder: options.pinnedEncoder,
      resolve,
      reject,
    };

    for (const listener of [...listeners]) {
      listener(job);
    }
  });
}

/**
 * Asks the page for its shot plan without recording anything. This is the
 * planning step of incremental rendering: it costs one page boot and tells the
 * renderer which segments the scene already has footage for, so an edit to one
 * shot re-renders that shot (and its segment) instead of the whole timeline.
 *
 * Scenes without `shots` still answer (with an empty list); callers treat that
 * as "no incremental plan" and keep the legacy path.
 */
export function probeVideoPlan(
  html: string,
  options: { signal?: AbortSignal } = {},
): Promise<VideoRenderPlan> {
  return new Promise<VideoRenderPlan>((resolve, reject) => {
    if (!html.includes("MOBILE_AGENT_VIDEO")) {
      reject(
        new Error(
          "The HTML does not implement the window.MOBILE_AGENT_VIDEO contract, so it cannot be planned.",
        ),
      );
      return;
    }

    if (!hasVideoRenderHost()) {
      reject(
        new Error(
          "Video rendering is only available on Android builds that include the video export module.",
        ),
      );
      return;
    }

    if (options.signal?.aborted) {
      reject(new Error("Video render was cancelled."));
      return;
    }

    const job: VideoProbeJob = {
      kind: "probe",
      id: `video-probe-${++jobCounter}`,
      html,
      signal: options.signal,
      resolve,
      reject,
    };

    for (const listener of [...listeners]) {
      listener(job);
    }
  });
}
