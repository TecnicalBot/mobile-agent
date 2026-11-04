import type {
  VideoExportShotPlan,
  VideoExportTimings,
} from "@/modules/preview/video-export-messages";

export type { VideoExportShotPlan, VideoExportTimings };

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
 * The scene's timing plus per-shot fingerprints, read from the page before a
 * render. `shots` is empty for legacy scenes; callers then keep the old
 * whole-document resume behavior.
 */
export type VideoRenderPlan = {
  duration: number;
  fps: number;
  width: number;
  height: number;
  sharedHash: string;
  shots: VideoExportShotPlan[];
};

export type VideoRenderJob = {
  kind: "render";
  id: string;
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
  const sharedHash = typeof raw.sharedHash === "string" ? raw.sharedHash.trim() : "";
  if (
    duration == null ||
    duration <= 0 ||
    duration > 600 ||
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
        typeof shot.id === "string" && shot.id ? shot.id : `shot-${shots.length + 1}`;
      shots.push({ id, start, end, hash });
    }
  }
  shots.sort((a, b) => a.start - b.start || a.end - b.end);
  return { duration, fps, width, height, sharedHash, shots };
}

/**
 * Requests an MP4 for a self-contained HTML document that implements the
 * `window.MOBILE_AGENT_VIDEO` contract. Resolves with the recorded file.
 */
export function requestVideoRender(
  html: string,
  options: {
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
