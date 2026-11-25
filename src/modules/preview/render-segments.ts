import { Directory, File, Paths } from "expo-file-system";

import {
  readContractDuration,
  readContractFps,
  readContractSize,
} from "@/modules/preview/video-audio";
import {
  createDeviceRenderBackend,
  type RenderBackend,
  type SegmentArtifact,
} from "@/modules/preview/render-backend";
import type {
  VideoExportTimings,
  VideoRenderPlan,
} from "@/modules/preview/video-render";

/**
 * Segments stay inside the validated per-render envelope (frames, bridge,
 * abort headroom): 45 s at 30 fps is 1350 frames, still bounded by the
 * encoder's dequeue depth rather than job length, and the 180 s silence
 * watchdog outlives any stuck segment. Longer segments amortize the
 * per-segment fixed costs the timing phases exposed — page boot, first-frame
 * setup, audio prep — over 50% more footage.
 */
export const SEGMENT_SECONDS = 45;

/**
 * Shot-aligned plans aim for at most this many segments. Each segment pays a
 * page boot, a first-frame setup, and a whole-file audio decode, so unbounded
 * splitting would make a first render slower than real time. The native
 * concatenator also accepts 1–32 inputs; 12 leaves ample headroom.
 */
export const MAX_SHOT_SEGMENTS = 12;

/** Never plan a shot segment shorter than this (unless it is the last one). */
export const MIN_SHOT_SEGMENT_SECONDS = 5;

/** One time window of the timeline, with the shot fingerprints it renders. */
export type SceneSegment = {
  offset: number;
  length: number;
  /** `id:hash` for every shot touched; empty for base-render gaps. */
  keys: string[];
};

/**
 * One editable clip of an editor export: a single shot or a gap between
 * shots, split into render-sized segments so a long shot still stays inside
 * one page's frame budget.
 */
export type EditorClipPlan = {
  id: string;
  label: string;
  start: number;
  end: number;
  keys: string[];
  shotId?: string;
  segments: SceneSegment[];
};

/** A finished per-shot MP4 that an editor can import on its own. */
export type EditorClipRenderResult = {
  id: string;
  label: string;
  /** Package-relative file name, e.g. `01-intro.mp4`. */
  fileName: string;
  /** `file://` URI of the clip MP4 in the temporary package directory. */
  uri: string;
  start: number;
  end: number;
  duration: number;
  hasAudio: boolean;
  shotId?: string;
};

export type SegmentRenderResult = {
  uri: string;
  hasAudio: boolean;
  audioWarnings: string[];
  warnings: string[];
  /** Timeline length the render used, when known. */
  duration?: number;
  /** Per-stage timing summary of the slowest measured segment, when reported. */
  timings?: VideoExportTimings;
  /**
   * Wall-clock attribution for the run, summed over freshly rendered segments
   * (cached resume segments contribute nothing). Instrumentation for slow-
   * render analysis; never gates or changes the render.
   */
  phases?: {
    /** Whole run body: every segment plus the native join (ms). */
    totalMs: number;
    /** Native concat only (ms); absent for single-pass renders. */
    concatMs?: number;
    /** Σ job start → WebView load end across fresh segments (ms). */
    pageLoadTotalMs?: number;
    /** Σ job start → first frame message across fresh segments (ms); includes page load. */
    firstFrameTotalMs?: number;
    /** Σ soundtrack prep before frame 1 across fresh segments (ms). */
    audioPrepTotalMs?: number;
  };
  /** Non-fatal performance notes derived from the timings. */
  perfWarnings: string[];
  /** One-time clip-mapping diagnostics, deduped across segments. */
  visualWarnings: string[];
  /** Device codec that encoded the video, when the native module reported one. */
  encoder?: string;
  /**
   * Present when the scene declared shots: how much of the timeline was
   * actually re-encoded versus reused from cache. The point of incremental
   * rendering is that a one-shot edit does not touch the other shots.
   */
  incremental?: {
    shots: number;
    renderedSegments: number;
    reusedSegments: number;
  };
  /** Present only for `editorClips` renders: one importable MP4 per shot/gap. */
  clips?: EditorClipRenderResult[];
  /** Present only for `editorClips` renders: temp package dir + timeline metadata. */
  editorPackage?: {
    directoryUri: string;
    fps: number;
    width: number;
    height: number;
  };
};

type Aggregated = {
  hasAudio: boolean;
  audioWarnings: string[];
  perfWarnings: string[];
  visualWarnings: string[];
  timings?: VideoExportTimings;
  phasePageLoadMs: number;
  phaseFirstFrameMs: number;
  phaseAudioPrepMs: number;
  haveFixedCosts: boolean;
  encoder?: string;
};

const EPSILON = 1e-6;

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

/**
 * Splits a timeline into shot-aligned segments. Rules, in priority order:
 *
 *  1. Never render through a shot boundary inside one segment's cache key —
 *     segments cut at shot edges, so an edit to one shot can only invalidate
 *     the segments that contain it.
 *  2. No segment exceeds {@link SEGMENT_SECONDS} (one page render).
 *  3. Aim for ~total/{@link MAX_SHOT_SEGMENTS} seconds per segment, and never
 *     plan more segments than the first render can afford.
 *  4. Gaps between shots (base-render footage) are ordinary pieces: they carry
 *     no shot key, and the shared hash already invalidates them on any change.
 *
 * Exported for tests: the geometry is what makes reuse correct.
 */
export function planShotSegments(
  total: number,
  shots: VideoRenderPlan["shots"],
): SceneSegment[] {
  if (!(total > EPSILON)) return [];

  const clampTime = (value: number) => Math.max(0, Math.min(total, value));
  const clean = shots
    .map((shot) => ({
      ...shot,
      start: clampTime(shot.start),
      end: clampTime(shot.end),
    }))
    .filter((shot) => shot.end - shot.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Every shot edge is a cut point; nothing is cut inside a shot here.
  const boundarySet = new Set<number>([0, total]);
  for (const shot of clean) {
    boundarySet.add(shot.start);
    boundarySet.add(shot.end);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  type Piece = { start: number; end: number; keys: string[] };
  const pieces: Piece[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end - start <= EPSILON) continue;
    // Pieces are built from shot edges, so a piece is wholly inside one shot
    // or wholly inside a gap between shots.
    const shot = clean.find(
      (candidate) =>
        candidate.start <= start + EPSILON && candidate.end >= end - EPSILON,
    );
    pieces.push({
      start,
      end,
      keys: shot ? [`${shot.id}:${shot.hash}`] : [],
    });
  }

  // A single shot longer than the page budget must be split anyway; the
  // sub-windows share the shot key (it cannot be reused more finely).
  const split: Piece[] = [];
  for (const piece of pieces) {
    const length = piece.end - piece.start;
    if (length <= SEGMENT_SECONDS + EPSILON) {
      split.push(piece);
      continue;
    }
    const parts = Math.ceil(length / SEGMENT_SECONDS);
    for (let i = 0; i < parts; i += 1) {
      split.push({
        start: piece.start + (length * i) / parts,
        end: piece.start + (length * (i + 1)) / parts,
        keys: piece.keys,
      });
    }
  }

  if (split.length === 0) {
    return [{ offset: 0, length: roundTime(total), keys: [] }];
  }

  // Very short scenes would otherwise round down to a single segment, making
  // reuse impossible even when the scene declares independent shots. Give a
  // scene of at least 4 s with two shots a two-segment floor; the 5 s policy
  // still governs everything longer.
  const minSegments = total >= 4 && clean.length >= 2 ? 2 : 1;
  const maxSegments = Math.max(
    minSegments,
    Math.min(
      MAX_SHOT_SEGMENTS,
      Math.floor(total / MIN_SHOT_SEGMENT_SECONDS) || 1,
    ),
  );
  const target = total / maxSegments;
  const segments: SceneSegment[] = [];
  let segStart = 0;
  let keys: string[] = [];

  const flush = (end: number) => {
    if (end - segStart <= EPSILON) return;
    segments.push({
      offset: roundTime(segStart),
      length: roundTime(end - segStart),
      keys: uniqueSorted(keys),
    });
    segStart = end;
    keys = [];
  };

  for (let i = 0; i < split.length; i += 1) {
    const piece = split[i];
    const wouldBe = piece.end - segStart;
    const accumulated = piece.start - segStart;
    // Cut before this piece when the current segment is already at its share,
    // or when adding the piece would overflow one page render. Comparing
    // `accumulated` (not `wouldBe`) keeps target-sized segments from ending one
    // piece early.
    const shouldCut =
      accumulated > EPSILON &&
      (accumulated >= target || wouldBe > SEGMENT_SECONDS + EPSILON);
    if (shouldCut) flush(piece.start);
    for (const key of piece.keys) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  flush(total);

  return segments.length > 0
    ? segments
    : [{ offset: 0, length: roundTime(total), keys: [] }];
}

/**
 * Plans one editable clip per shot (and one per gap between shots) for an
 * editor export. Unlike {@link planShotSegments}, clips are never merged: the
 * point is one importable MP4 per story beat, so a 30 s scene with two shots
 * yields two 15 s clips rather than a single timeline segment.
 *
 * A clip longer than one page render is split into equal sub-segments; the
 * renderer joins them back into one clip MP4. Exported for tests.
 */
export function planEditorClips(
  total: number,
  shots: VideoRenderPlan["shots"],
): EditorClipPlan[] {
  if (!(total > EPSILON)) return [];

  const clampTime = (value: number) => Math.max(0, Math.min(total, value));
  const clean = shots
    .map((shot) => ({
      ...shot,
      start: clampTime(shot.start),
      end: clampTime(shot.end),
    }))
    .filter((shot) => shot.end - shot.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Overlapping shots are invalid scene data; keep the first one so the clip
  // windows never overlap (an editor timeline cannot stack two clips at once).
  const accepted: typeof clean = [];
  let coveredTo = 0;
  for (const shot of clean) {
    if (shot.start < coveredTo - EPSILON) continue;
    accepted.push(shot);
    coveredTo = shot.end;
  }

  // A flat scene (no shots) exports as one clip equal to the full video, with
  // a readable label instead of calling the whole timeline a gap.
  if (accepted.length === 0) {
    const parts = Math.max(1, Math.ceil(total / SEGMENT_SECONDS - EPSILON));
    const segments: SceneSegment[] = [];
    for (let i = 0; i < parts; i += 1) {
      const start = (total * i) / parts;
      const end = (total * (i + 1)) / parts;
      segments.push({
        offset: roundTime(start),
        length: roundTime(end - start),
        keys: [],
      });
    }
    return [
      {
        id: "full",
        label: "Full video",
        start: 0,
        end: roundTime(total),
        keys: [],
        segments,
      },
    ];
  }

  type Window = {
    start: number;
    end: number;
    keys: string[];
    label: string;
    shotId?: string;
  };
  const windows: Window[] = [];
  let cursor = 0;
  let gapCount = 0;

  for (const shot of accepted) {
    if (shot.start > cursor + EPSILON) {
      gapCount += 1;
      windows.push({
        start: cursor,
        end: shot.start,
        keys: [],
        label: `Gap ${gapCount}`,
      });
    }
    windows.push({
      start: shot.start,
      end: shot.end,
      keys: [`${shot.id}:${shot.hash}`],
      label: shot.id,
      shotId: shot.id,
    });
    cursor = shot.end;
  }

  if (total > cursor + EPSILON) {
    gapCount += 1;
    windows.push({
      start: cursor,
      end: total,
      keys: [],
      label: `Gap ${gapCount}`,
    });
  }

  if (windows.length === 0) {
    windows.push({ start: 0, end: total, keys: [], label: "Full video" });
  }

  let gapId = 0;
  return windows.map((window) => {
    const length = window.end - window.start;
    const parts = Math.max(1, Math.ceil(length / SEGMENT_SECONDS - EPSILON));
    const segments: SceneSegment[] = [];
    for (let i = 0; i < parts; i += 1) {
      const start = window.start + (length * i) / parts;
      const end = window.start + (length * (i + 1)) / parts;
      segments.push({
        offset: roundTime(start),
        length: roundTime(end - start),
        keys: [...window.keys],
      });
    }

    return {
      id: window.shotId ? `shot-${window.shotId}` : `gap-${++gapId}`,
      label: window.label,
      start: roundTime(window.start),
      end: roundTime(window.end),
      keys: [...window.keys],
      ...(window.shotId ? { shotId: window.shotId } : {}),
      segments,
    };
  });
}

/**
 * Renders the document, segmenting timelines over SEGMENT_SECONDS into
 * ordinary render jobs and concatenating the MP4s natively. Short videos
 * take the legacy single render (zero behavior change). Segment files live
 * in cache keyed by source so a failed run resumes by re-rendering only
 * the missing pieces.
 *
 * When the scene declares `shots`, a probe reads each shot's fingerprint
 * first and the timeline is planned at shot boundaries. Segments are cached
 * under `sharedHash + shot hashes`, so editing one shot re-encodes only the
 * segments that contain it and reuses every other segment; any change to
 * shared scene code, assets, clips, or the audio schedule changes the shared
 * hash and correctly invalidates everything. Legacy scenes keep the old
 * whole-document cache and delete segments after a successful run.
 *
 * Resumed segments must share ONE encoder with the fresh ones: concat
 * sample-copies every segment under the first segment's H.264 parameters
 * (SPS/PPS), so each segment's sidecar records the codec that made it and
 * the run pins every later render to it — across app restarts included. A
 * concat that refuses the set reports the error and keeps completed segments.
 * Never silently restart a finished render or discard its completed footage.
 *
 * This is the single render engine shared by both surfaces: the `renderVideo`
 * tool (hidden host, output moved into the workspace) and the preview
 * dialog's Export button (same hidden host queue, output saved to Downloads).
 * Kept in `@/modules/preview` — not in the tool module — so the UI can import
 * it without pulling the `ai`/`zod` tool stack into the component tree.
 */
export async function renderSegments(options: {
  abortSignal?: AbortSignal;
  /**
   * Where segments are produced. Omitted = the on-device pipeline, so existing
   * callers keep byte-identical behaviour. The segment cache, shot reuse, and
   * concat order are owned here and must not depend on this value.
   */
  backend?: RenderBackend;
  conversationId?: string;
  contractDuration: number | null;
  documentHtml: string;
  /**
   * Render one MP4 per shot (and per gap) for an editor package, in addition
   * to the finished full video. Slower than a normal render because each clip
   * is joined separately, but the segment footage itself is rendered once and
   * cached for revisions.
   */
  editorClips?: boolean;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
  /**
   * Cache key for segment resume files. Both callers pass a content hash of
   * the inlined document (`hashDocumentKey`), so retrying the *same* scene
   * resumes and an *edited* scene starts fresh — a workspace file id would be
   * stable across edits (`updateDocumentFile` rewrites in place) and would
   * serve the previous version's segments.
   *
   * Shot-aware runs ignore this and key on the probe's shared/shot hashes.
   */
  sourceFileId: string;
}): Promise<SegmentRenderResult> {
  const { abortSignal, contractDuration, documentHtml, onProgress } = options;
  const backend = options.backend ?? createDeviceRenderBackend();

  if (options.editorClips) {
    return renderEditorTimeline({
      abortSignal,
      backend,
      conversationId: options.conversationId,
      contractDuration,
      documentHtml,
      onProgress,
    });
  }

  // A probe costs one page boot, so only scenes that look shot-structured
  // pay it. A false positive is harmless: the page reports no shots and the
  // legacy path runs unchanged.
  if (backend.supportsProbe && /\bshots\s*:/.test(documentHtml)) {
    let plan: VideoRenderPlan | null = null;
    try {
      plan = await backend.probe(documentHtml, { signal: abortSignal });
    } catch {
      // A probe is an optimization, never a gate. Fall through to the legacy
      // path; the actual render will surface any real page failure.
      plan = null;
    }
    if (plan && plan.shots.length > 0) {
      return renderPlannedTimeline({
        abortSignal,
        backend,
        conversationId: options.conversationId,
        documentHtml,
        onProgress,
        plan,
      });
    }
  }

  return renderLegacyTimeline({
    abortSignal,
    backend,
    conversationId: options.conversationId,
    contractDuration,
    documentHtml,
    onProgress,
    sourceFileId: options.sourceFileId,
  });
}

async function renderLegacyTimeline(options: {
  abortSignal?: AbortSignal;
  backend: RenderBackend;
  conversationId?: string;
  contractDuration: number | null;
  documentHtml: string;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
  sourceFileId: string;
}): Promise<SegmentRenderResult> {
  const { abortSignal, backend, contractDuration, documentHtml, onProgress, sourceFileId } =
    options;

  const reportProgress = (base: number, span: number, segProgress: number) => {
    const overall = span <= 0 ? 0 : Math.max(0, Math.min(1, base + segProgress * span));
    // Keep 100% for successful completion, not merely the last encoded frame.
    // Basis-point units preserve sub-percent progress for the decimal UI.
    onProgress?.({ bytesWritten: Math.min(9900, Math.floor(overall * 9900)), totalBytes: 10000 });
  };
  const runOne = (
    segment: { offset: number; length: number } | undefined,
    weight: { base: number; span: number },
    pinnedEncoder?: string,
  ) => {
    return backend.renderSegment({
      documentHtml,
      duration: contractDuration ?? undefined,
      segment,
      progress: weight,
      pinnedEncoder,
      conversationId: options.conversationId,
      signal: abortSignal,
      onProgress: (fraction) => reportProgress(weight.base, weight.span, fraction),
    });
  };

  if (contractDuration == null || contractDuration <= SEGMENT_SECONDS) {
    const startedAt = Date.now();
    const result = await runOne(undefined, { base: 0, span: 1 });
    onProgress?.({ bytesWritten: 10000, totalBytes: 10000 });
    const timings = result.timings;
    return {
      uri: result.uri,
      hasAudio: result.hasAudio,
      audioWarnings: result.audioWarnings,
      warnings: [],
      duration: contractDuration ?? undefined,
      timings: result.timings,
      phases: {
        totalMs: Date.now() - startedAt,
        ...(timings?.pageLoadMs == null ? {} : { pageLoadTotalMs: timings.pageLoadMs }),
        ...(timings?.firstFrameMs == null ? {} : { firstFrameTotalMs: timings.firstFrameMs }),
        ...(timings?.audioPrepMs == null ? {} : { audioPrepTotalMs: timings.audioPrepMs }),
      },
      perfWarnings: result.perfWarnings ?? [],
      visualWarnings: result.visualWarnings ?? [],
      encoder: result.encoder,
    };
  }

  const total = contractDuration;
  const count = Math.ceil(total / SEGMENT_SECONDS);
  // Cache entries carry their exact time window in the name, so a file can
  // only ever satisfy that window: a segment-length change (or any future
  // one) re-renders instead of silently splicing footage rendered under a
  // different layout into the new timeline.
  //
  // The name also carries the encoder profile (`@h264_mediacodec-unknown-…`).
  // Concat sample-copies under the first segment's SPS/PPS, so footage from a
  // different encoder is never reusable — and legacy scenes have no probe, so
  // the profile has no dimensions yet.
  const profile = backend.profileFor(null);
  const stem = `render-${sourceFileId}@${profile.id}`;
  const sidecar = (index: number, offset: number, length: number) =>
    new File(Paths.cache, `${stem}-seg-${index}-${offset}-${length}.json`);

  const renderAll = async () => {
    const startedAt = Date.now();
    const aggregated: Aggregated = {
      hasAudio: false,
      audioWarnings: [],
      perfWarnings: [],
      visualWarnings: [],
      phasePageLoadMs: 0,
      phaseFirstFrameMs: 0,
      phaseAudioPrepMs: 0,
      haveFixedCosts: false,
    };
    // A backend that can run segments concurrently cannot wait for segment 1
    // to reveal the encoder, so it declares it up front. The device (one job at
    // a time) keeps the observed-encoder behaviour below, byte for byte.
    let runEncoder: string | undefined =
      backend.concurrency > 1 ? profile.encoder : undefined;
    let slowest: { timings?: VideoExportTimings; cost: number } | null = null;
    const uris: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const offset = i * SEGMENT_SECONDS;
      const length = Math.min(SEGMENT_SECONDS, total - offset);
      const segFile = new File(Paths.cache, `${stem}-seg-${i}-${offset}-${length}.mp4`);
      if (segFile.exists) {
        let meta: SegmentSidecar | null = null;
        try {
          meta = JSON.parse(await sidecar(i, offset, length).text());
        } catch {
          // Unreadable sidecar: keep the footage, audio flags stay
          // conservative and the encoder stays unknown (concat still verifies
          // parameters, and a mismatch self-heals below).
          meta = null;
        }
        if (meta?.profile && meta.profile !== profile.id) {
          // Only reachable if a file was renamed or copied by hand; the name
          // already carries the profile. Treat it as a miss, not as footage.
          meta = null;
        } else {
          const cachedEncoder =
            meta && typeof meta.encoder === "string" && meta.encoder ? meta.encoder : undefined;
          // Keep the cached segment unless it is known to have been made by a
          // *different* encoder than this run — feeding concat a known-bad mix
          // would only fail after every other segment finished.
          if (!runEncoder || !cachedEncoder || cachedEncoder === runEncoder) {
            if (cachedEncoder) runEncoder = cachedEncoder;
            uris.push(segFile.uri);
            adoptSidecar(aggregated, meta);
            continue;
          }
          // Made by another encoder: drop just this segment and re-render it
          // under the run's pin.
          try {
            await segFile.delete();
            await sidecar(i, offset, length).delete();
          } catch {
            // Best-effort; a leftover file would fail the move below loudly.
          }
        }
      }
      let result;
      try {
        result = await runOne(
          { offset, length },
          { base: offset / total, span: length / total },
          runEncoder,
        );
      } catch (error) {
        throw new Error(
          `Segment ${i + 1}/${count} (t=${offset}-${Math.round((offset + length) * 100) / 100}s) failed: ${error instanceof Error ? error.message : String(error)}. Re-run to resume — finished segments are kept.`,
        );
      }
      if (result.encoder && !runEncoder) runEncoder = result.encoder;
      const timings = adoptResult(aggregated, result);
      if (timings) {
        const cost = timings.prepareAvgMs + timings.captureAvgMs + timings.bridgeAvgMs;
        if (!slowest || cost > slowest.cost) slowest = { timings, cost };
      }
      await new File(result.uri).move(segFile, { overwrite: true });
      try {
        await sidecar(i, offset, length).write(
          JSON.stringify({
            hasAudio: result.hasAudio,
            audioWarnings: result.audioWarnings,
            perfWarnings: result.perfWarnings ?? [],
            visualWarnings: aggregated.visualWarnings,
            encoder: result.encoder,
            profile: profile.id,
            origin: backend.kind,
          }),
        );
      } catch {
        // Sidecar is resume metadata only; footage is already safe.
      }
      uris.push(segFile.uri);
    }

    const outFile = new File(Paths.cache, `${stem}-full.mp4`);
    reportProgress(0, 1, 1);
    const concatStartedAt = Date.now();
    try {
      await backend.concat(uris, outFile.uri);
    } catch (error) {
      throw new Error(
        `Video segments finished, but joining failed. Completed segments were kept; the export did not restart automatically. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const concatMs = Date.now() - concatStartedAt;

    return {
      uris,
      outFile,
      aggregated,
      slowest,
      concatMs,
      totalMs: Date.now() - startedAt,
    };
  };

  const merged = await renderAll();
  for (const uri of merged.uris) {
    try {
      await new File(uri).delete();
    } catch {
      // Best-effort cache cleanup; segments are small and bounded.
    }
  }
  onProgress?.({ bytesWritten: 10000, totalBytes: 10000 });
  return {
    uri: merged.outFile.uri,
    hasAudio: merged.aggregated.hasAudio,
    audioWarnings: merged.aggregated.audioWarnings,
    duration: total,
    timings: merged.slowest?.timings,
    phases: buildPhases(merged, true),
    perfWarnings: merged.aggregated.perfWarnings,
    visualWarnings: merged.aggregated.visualWarnings,
    encoder: merged.aggregated.encoder,
    warnings: [
      `Rendered in ${count} segments and concatenated; per-segment audio fades up to 50 ms at seams.`,
    ],
  };
}

/**
 * Shot-aligned incremental render. Segments live in cache after a successful
 * run (unlike the legacy path) so the next revision can reuse the footage of
 * every shot it did not touch.
 */
async function renderPlannedTimeline(options: {
  abortSignal?: AbortSignal;
  backend: RenderBackend;
  conversationId?: string;
  documentHtml: string;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
  plan: VideoRenderPlan;
}): Promise<SegmentRenderResult> {
  const { abortSignal, backend, documentHtml, onProgress, plan } = options;
  const total = plan.duration;
  const segments = planShotSegments(total, plan.shots);
  // Footage is only interchangeable inside one encoder profile: concat
  // sample-copies under the first segment's SPS/PPS, so a device encode and a
  // remote encode of the same scene must never share a namespace.
  const profile = backend.profileFor(plan);
  const namespace = `${plan.sharedHash}@${profile.id}`;
  const startedAt = Date.now();
  const uris: string[] = [];
  const keepNames = new Set<string>();
  const aggregated: Aggregated = {
    hasAudio: false,
    audioWarnings: [],
    perfWarnings: [],
    visualWarnings: [],
    phasePageLoadMs: 0,
    phaseFirstFrameMs: 0,
    phaseAudioPrepMs: 0,
    haveFixedCosts: false,
  };
  // Declared up front when segments can run concurrently; see the legacy path.
  let runEncoder: string | undefined =
    backend.concurrency > 1 ? profile.encoder : undefined;
  let slowest: { timings?: VideoExportTimings; cost: number } | null = null;
  let renderedSegments = 0;
  let reusedSegments = 0;

  const baseName = (segment: SceneSegment) =>
    `render-${namespace}-${segment.offset}-${segment.length}-${hashSegmentKeys(segment.keys)}`;
  const filesFor = (segment: SceneSegment) => {
    const base = baseName(segment);
    return {
      video: new File(Paths.cache, `${base}.mp4`),
      sidecar: new File(Paths.cache, `${base}.json`),
      names: [`${base}.mp4`, `${base}.json`],
    };
  };

  // Segments are contiguous from 0, so `bases[i]` is exactly the old
  // `offset / total`: the device's progress bar is unchanged. What changes is
  // that progress is now a weighted sum over segments, because a pool finishes
  // them out of order.
  const weights = segments.map((segment) => segment.length / total);
  const bases: number[] = [];
  {
    let accumulated = 0;
    for (const weight of weights) {
      bases.push(accumulated);
      accumulated += weight;
    }
  }
  const fractions = segments.map(() => 0);
  const settled = segments.map(() => false);
  let reported = 0;
  const reportOverall = (overall: number) => {
    // Monotonic: a segment's reported fraction can wobble, and a pool finishes
    // out of order. The bar never walks backwards.
    reported = Math.max(reported, Math.max(0, Math.min(1, overall)));
    onProgress?.({
      bytesWritten: Math.min(9900, Math.floor(reported * 9900)),
      totalBytes: 10000,
    });
  };
  const reportProgress = () => {
    let sum = 0;
    for (let i = 0; i < segments.length; i += 1) {
      sum += weights[i] * (settled[i] ? 1 : fractions[i]);
    }
    reportOverall(sum);
  };

  const renderSegmentAt = (i: number) => {
    const segment = segments[i];
    return backend.renderSegment({
      documentHtml,
      duration: total,
      segment: { offset: segment.offset, length: segment.length },
      progress: { base: bases[i], span: weights[i] },
      pinnedEncoder: runEncoder,
      conversationId: options.conversationId,
      signal: abortSignal,
      onProgress: (fraction) => {
        fractions[i] = Math.max(fractions[i], fraction);
        reportProgress();
      },
    });
  };

  // ── Resolve: which segments are already on disk ────────────────────────────
  // Cache hits are resolved before any rendering so a resumed run pins the
  // encoder from the footage it already has, instead of re-encoding the tail
  // of the timeline to match whatever the first fresh segment happened to use.
  const files = segments.map((segment) => filesFor(segment));
  for (const { names } of files) {
    for (const name of names) keepNames.add(name);
  }

  const cached = segments.map(() => false);
  const pending: number[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const { video: segFile, sidecar } = files[i];
    if (segFile.exists) {
      let meta: SegmentSidecar | null = null;
      try {
        meta = JSON.parse(await sidecar.text());
      } catch {
        meta = null;
      }
      if (meta?.profile && meta.profile !== profile.id) {
        // The name already carries the profile; a mismatch means the file was
        // moved here by hand. Treat it as a miss rather than as footage.
        meta = null;
      } else {
        const cachedEncoder =
          meta && typeof meta.encoder === "string" && meta.encoder ? meta.encoder : undefined;
        if (!runEncoder || !cachedEncoder || cachedEncoder === runEncoder) {
          if (cachedEncoder) runEncoder = cachedEncoder;
          adoptSidecar(aggregated, meta);
          reusedSegments += 1;
          cached[i] = true;
          settled[i] = true;
          fractions[i] = 1;
          continue;
        }
        // Footage from another encoder cannot join this output video.
        try {
          await segFile.delete();
          await sidecar.delete();
        } catch {
          // Best-effort; the move below fails loudly if it survives.
        }
      }
    }
    pending.push(i);
  }
  reportProgress();

  // ── Render: bounded pool over the pending segments ─────────────────────────
  const artifacts = new Map<number, SegmentArtifact>();
  const failureOf = (i: number, error: unknown) =>
    new Error(
      `Segment ${i + 1}/${segments.length} (t=${segments[i].offset}-${Math.round((segments[i].offset + segments[i].length) * 100) / 100}s) failed: ${error instanceof Error ? error.message : String(error)}. Re-run to resume — finished segments are kept.`,
    );
  const limit = Math.max(1, Math.min(backend.concurrency, pending.length));
  let failure: Error | null = null;

  try {
    if (limit === 1) {
      // Sequential: the encoder observed on one segment still pins the next, so
      // device behaviour is unchanged. A backend that can run segments in
      // parallel declares its encoder up front and takes the pool branch.
      for (const i of pending) {
        if (abortSignal?.aborted) throw new Error("Video render was cancelled.");
        let result: SegmentArtifact;
        try {
          result = await renderSegmentAt(i);
        } catch (error) {
          throw failureOf(i, error);
        }
        artifacts.set(i, result);
        if (result.encoder && !runEncoder) runEncoder = result.encoder;
      }
    } else {
      let cursor = 0;
      // Held in an object: TypeScript's control-flow analysis would otherwise
      // narrow a `let` assigned inside the worker closure to `null` forever.
      const first: { current: { index: number; error: unknown } | null } = {
        current: null,
      };
      const worker = async () => {
        for (;;) {
          if (first.current || abortSignal?.aborted) return;
          const next = cursor;
          cursor += 1;
          if (next >= pending.length) return;
          const i = pending[next];
          try {
            artifacts.set(i, await renderSegmentAt(i));
          } catch (error) {
            // Keep the first failure and stop launching. In-flight segments are
            // allowed to land so their footage is cached for the retry.
            if (!first.current) first.current = { index: i, error };
            return;
          }
        }
      };
      await Promise.all(Array.from({ length: limit }, () => worker()));
      const failed = first.current;
      if (failed) throw failureOf(failed.index, failed.error);
      if (abortSignal?.aborted) throw new Error("Video render was cancelled.");
    }
  } catch (error) {
    // Assemble below still runs: a failed or cancelled run must keep every
    // finished segment, or "re-run to resume" would be a lie.
    failure = error instanceof Error ? error : new Error(String(error));
  }

  // ── Assemble in timeline order ─────────────────────────────────────────────
  // Order is what makes concat correct: the first segment's SPS/PPS is the one
  // every later segment is copied under.
  for (let i = 0; i < segments.length; i += 1) {
    const { video: segFile, sidecar } = files[i];
    if (cached[i]) {
      uris.push(segFile.uri);
      continue;
    }
    const result = artifacts.get(i);
    if (!result) {
      if (failure) continue;
      throw new Error(`Segment ${i + 1}/${segments.length} produced no footage.`);
    }
    const timings = adoptResult(aggregated, result);
    if (timings) {
      const cost = timings.prepareAvgMs + timings.captureAvgMs + timings.bridgeAvgMs;
      if (!slowest || cost > slowest.cost) slowest = { timings, cost };
    }
    await new File(result.uri).move(segFile, { overwrite: true });
    try {
      await sidecar.write(
        JSON.stringify({
          hasAudio: result.hasAudio,
          audioWarnings: result.audioWarnings,
          perfWarnings: result.perfWarnings ?? [],
          visualWarnings: aggregated.visualWarnings,
          encoder: result.encoder,
          profile: profile.id,
          origin: backend.kind,
        }),
      );
    } catch {
      // Sidecar is cache metadata only; footage is already safe.
    }
    uris.push(segFile.uri);
    renderedSegments += 1;
    settled[i] = true;
    fractions[i] = 1;
    reportProgress();
  }

  if (failure) throw failure;

  const outFile = new File(Paths.cache, `render-${namespace}-full.mp4`);
  reportOverall(1);
  const concatStartedAt = Date.now();
  try {
    await backend.concat(uris, outFile.uri);
  } catch (error) {
    throw new Error(
      `Video segments finished, but joining failed. Completed segments were kept; the export did not restart automatically. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const concatMs = Date.now() - concatStartedAt;

  // The footage just joined is the cache for the next revision: keep it and
  // drop only same-scene leftovers from earlier shot layouts/edits.
  await pruneSceneSegments(namespace, keepNames);

  onProgress?.({ bytesWritten: 10000, totalBytes: 10000 });
  return {
    uri: outFile.uri,
    hasAudio: aggregated.hasAudio,
    audioWarnings: aggregated.audioWarnings,
    duration: total,
    timings: slowest?.timings,
    phases: {
      totalMs: Date.now() - startedAt,
      concatMs,
      ...(aggregated.haveFixedCosts
        ? {
            pageLoadTotalMs: aggregated.phasePageLoadMs,
            firstFrameTotalMs: aggregated.phaseFirstFrameMs,
            audioPrepTotalMs: aggregated.phaseAudioPrepMs,
          }
        : {}),
    },
    perfWarnings: aggregated.perfWarnings,
    visualWarnings: aggregated.visualWarnings,
    encoder: runEncoder,
    incremental: {
      shots: plan.shots.length,
      renderedSegments,
      reusedSegments,
    },
    warnings:
      segments.length > 1
        ? [
            `Rendered in ${segments.length} shot-aligned segments (${renderedSegments} re-encoded, ${reusedSegments} reused) and concatenated; per-segment audio fades up to 50 ms at seams.`,
          ]
        : [],
  };
}

/**
 * Editor export: renders one importable MP4 per shot (plus gaps), joins each
 * clip's segments, and joins the whole timeline into the finished video.
 *
 * The clip files are written to a temporary package directory with readable
 * names (`01-intro.mp4`) so mobile editors see sensible file names after the
 * gallery copy. Segments stay in the normal cache namespace (`ed-...`) and are
 * reused across revisions exactly like a shot-aware render.
 */
async function renderEditorTimeline(options: {
  abortSignal?: AbortSignal;
  backend: RenderBackend;
  conversationId?: string;
  contractDuration: number | null;
  documentHtml: string;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
}): Promise<
  SegmentRenderResult & {
    clips: EditorClipRenderResult[];
    editorPackage: {
      directoryUri: string;
      fps: number;
      width: number;
      height: number;
    };
  }
> {
  const { abortSignal, backend, documentHtml, onProgress } = options;
  const startedAt = Date.now();

  // An editor package needs fps/size for its timelines, and one boot is cheap
  // next to rendering the clips. A probe failure is not fatal: fall back to
  // the contract literals and a single-clip timeline.
  let plan: VideoRenderPlan | null = null;
  try {
    plan = backend.supportsProbe
      ? await backend.probe(documentHtml, { signal: abortSignal })
      : null;
  } catch {
    plan = null;
  }

  // Prefer the first positive length/fps/size. A probe can answer with a
  // zeroed plan for a scene that has not declared them, and a zero here would
  // otherwise beat a valid contract value.
  const total =
    [plan?.duration, options.contractDuration, readContractDuration(documentHtml)]
      .find((value): value is number => typeof value === "number" && value > EPSILON) ??
    0;
  if (!(total > EPSILON)) {
    throw new Error(
      "Cannot export an editor package: the video duration is unknown. Pass `duration` (the contract's length in seconds) and try again.",
    );
  }

  const fps =
    plan?.fps && plan.fps > 0 ? plan.fps : (readContractFps(documentHtml) ?? 30);
  const contractSize = readContractSize(documentHtml);
  const size =
    plan != null && plan.width > 0 && plan.height > 0
      ? { width: plan.width, height: plan.height }
      : (contractSize ?? { width: 1280, height: 720 });
  const shots = plan?.shots ?? [];
  // Encoder profile, exactly like the other paths: editor footage is cached
  // per encoder, so a device segment and a GPU segment can never be joined.
  // `profileFor` is backend-specific and stable even when the probe failed.
  const profile = backend.profileFor(
    plan && plan.width > 0 && plan.height > 0 ? plan : null,
  );
  // Keep editor cache files in their own namespace so pruning them can never
  // delete the shot-aligned footage a `renderVideo` run is still resuming.
  const namespace = `ed-${plan?.sharedHash || hashDocumentKey(documentHtml)}@${profile.id}`;
  const clipPlans = planEditorClips(total, shots);
  const packageDir = new Directory(
    Paths.cache,
    `editor-${namespace}-${Date.now()}`,
  );
  try {
    if (packageDir.exists) packageDir.delete();
    packageDir.create({ idempotent: true, intermediates: true });
  } catch {
    // The first write below fails loudly if the directory cannot be created.
  }

  const aggregated: Aggregated = {
    hasAudio: false,
    audioWarnings: [],
    perfWarnings: [],
    visualWarnings: [],
    phasePageLoadMs: 0,
    phaseFirstFrameMs: 0,
    phaseAudioPrepMs: 0,
    haveFixedCosts: false,
  };
  // A backend that runs segments concurrently declares its encoder up front;
  // the device keeps the observed-encoder behaviour, exactly like the other
  // two paths.
  let runEncoder: string | undefined =
    backend.concurrency > 1 ? profile.encoder : undefined;
  let slowest: { timings?: VideoExportTimings; cost: number } | null = null;
  let renderedSegments = 0;
  let reusedSegments = 0;
  let concatMs = 0;
  let tempCounter = 0;
  const keepNames = new Set<string>();
  const allSegmentUris: string[] = [];
  const totalSegments = Math.max(
    1,
    clipPlans.reduce((sum, clip) => sum + clip.segments.length, 0),
  );
  let segmentIndex = 0;

  const reportProgress = (base: number, span: number, segProgress: number) => {
    const overall =
      span <= 0 ? 0 : Math.max(0, Math.min(1, base + segProgress * span));
    onProgress?.({
      bytesWritten: Math.min(9900, Math.floor(overall * 9900)),
      totalBytes: 10000,
    });
  };

  const runOne = (
    segment: { offset: number; length: number },
    weight: { base: number; span: number },
    pinnedEncoder?: string,
  ) =>
    backend.renderSegment({
      documentHtml,
      duration: total,
      segment,
      progress: weight,
      pinnedEncoder,
      conversationId: options.conversationId,
      signal: abortSignal,
      onProgress: (progress) => reportProgress(weight.base, weight.span, progress),
    });

  const filesFor = (segment: SceneSegment) => {
    const base = `render-${namespace}-ed-${segment.offset}-${segment.length}-${hashSegmentKeys(segment.keys)}`;
    return {
      video: new File(Paths.cache, `${base}.mp4`),
      sidecar: new File(Paths.cache, `${base}.json`),
      names: [`${base}.mp4`, `${base}.json`],
    };
  };

  const concatTo = async (uris: string[], outFile: File, label: string) => {
    const join = async (
      list: string[],
      destination: File,
      depth: number,
    ): Promise<void> => {
      if (list.length === 0) {
        throw new Error("No segments to join.");
      }
      if (list.length <= 32) {
        // Always a local join: segments are on the device by now, even when a
        // remote node rendered them.
        await backend.concat(list, destination.uri);
        return;
      }
      // The native concatenator accepts at most 32 inputs per call. Scenes
      // with many shots are rare, but batching keeps the export correct
      // instead of failing on a valid timeline.
      const intermediates: File[] = [];
      try {
        for (let i = 0; i < list.length; i += 32) {
          const chunk = list.slice(i, i + 32);
          const temp = new File(
            packageDir,
            `join-${depth}-${tempCounter++}.mp4`,
          );
          await backend.concat(chunk, temp.uri);
          intermediates.push(temp);
        }
        await join(
          intermediates.map((file) => file.uri),
          destination,
          depth + 1,
        );
      } finally {
        for (const file of intermediates) {
          try {
            await file.delete();
          } catch {
            // Best-effort cache cleanup.
          }
        }
      }
    };

    try {
      await join(uris, outFile, 0);
    } catch (error) {
      throw new Error(
        `${label} segments finished, but joining failed. Completed segments were kept; the export did not restart automatically. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const clips: EditorClipRenderResult[] = [];
  let keepPackage = false;

  try {
    for (let clipIndex = 0; clipIndex < clipPlans.length; clipIndex += 1) {
      const clipPlan = clipPlans[clipIndex]!;
      const clipUris: string[] = [];
      let clipHasAudio = false;

      for (const segment of clipPlan.segments) {
        const { video: segFile, sidecar, names } = filesFor(segment);
        for (const name of names) keepNames.add(name);

        if (segFile.exists) {
          let meta: SegmentSidecar | null = null;
          try {
            meta = JSON.parse(await sidecar.text());
          } catch {
            meta = null;
          }
          const cachedEncoder =
            meta && typeof meta.encoder === "string" && meta.encoder
              ? meta.encoder
              : undefined;
          const cachedProfile =
            meta && typeof meta.profile === "string" ? meta.profile : null;
          // A sidecar without a matching profile is not footage for this run:
          // concat would splice incompatible parameter sets.
          if (
            cachedProfile === profile.id &&
            (!runEncoder || !cachedEncoder || cachedEncoder === runEncoder)
          ) {
            if (cachedEncoder) runEncoder = cachedEncoder;
            clipUris.push(segFile.uri);
            allSegmentUris.push(segFile.uri);
            adoptSidecar(aggregated, meta);
            clipHasAudio = clipHasAudio || meta?.hasAudio === true;
            reusedSegments += 1;
            segmentIndex += 1;
            continue;
          }
          try {
            await segFile.delete();
            await sidecar.delete();
          } catch {
            // Best-effort; the move below fails loudly if it survives.
          }
        }

        const base = (segmentIndex / totalSegments) * 0.9;
        const span = 0.9 / totalSegments;
        let result;
        try {
          result = await runOne(
            { offset: segment.offset, length: segment.length },
            { base, span },
            runEncoder,
          );
        } catch (error) {
          throw new Error(
            `Clip ${clipIndex + 1}/${clipPlans.length} (${clipPlan.label}, t=${segment.offset}-${roundTime(segment.offset + segment.length)}s) failed: ${error instanceof Error ? error.message : String(error)}. Re-run to resume — finished segments are kept.`,
          );
        }
        if (result.encoder && !runEncoder) runEncoder = result.encoder;
        const timings = adoptResult(aggregated, result);
        if (timings) {
          const cost =
            timings.prepareAvgMs + timings.captureAvgMs + timings.bridgeAvgMs;
          if (!slowest || cost > slowest.cost) slowest = { timings, cost };
        }
        await new File(result.uri).move(segFile, { overwrite: true });
        try {
          await sidecar.write(
            JSON.stringify({
              hasAudio: result.hasAudio,
              audioWarnings: result.audioWarnings,
              perfWarnings: result.perfWarnings ?? [],
              visualWarnings: result.visualWarnings ?? [],
              encoder: result.encoder,
              profile: profile.id,
              origin: backend.kind,
            }),
          );
        } catch {
          // Sidecar is cache metadata only; footage is already safe.
        }
        clipUris.push(segFile.uri);
        allSegmentUris.push(segFile.uri);
        clipHasAudio = clipHasAudio || result.hasAudio;
        renderedSegments += 1;
        segmentIndex += 1;
      }

      const fileName = `${String(clipIndex + 1).padStart(2, "0")}-${clipFileSlug(clipPlan.label, clipIndex)}.mp4`;
      const clipFile = new File(packageDir, fileName);
      const concatStartedAt = Date.now();
      await concatTo(clipUris, clipFile, `Clip "${clipPlan.label}"`);
      concatMs += Date.now() - concatStartedAt;

      clips.push({
        id: clipPlan.id,
        label: clipPlan.label,
        fileName,
        uri: clipFile.uri,
        start: clipPlan.start,
        end: clipPlan.end,
        duration: roundTime(clipPlan.end - clipPlan.start),
        hasAudio: clipHasAudio,
        ...(clipPlan.shotId ? { shotId: clipPlan.shotId } : {}),
      });
    }

    const fullFile = new File(packageDir, "full.mp4");
    const concatStartedAt = Date.now();
    await concatTo(allSegmentUris, fullFile, "Finished video");
    concatMs += Date.now() - concatStartedAt;

    await pruneSceneSegments(namespace, keepNames);
    onProgress?.({ bytesWritten: 9900, totalBytes: 10000 });

    const warnings =
      clipPlans.length > 1
        ? [
            `Rendered ${clipPlans.length} editor clips across ${totalSegments} segment(s) and joined them; per-segment audio fades up to 50 ms at seams.`,
          ]
        : [];

    keepPackage = true;
    onProgress?.({ bytesWritten: 10000, totalBytes: 10000 });
    return {
      uri: fullFile.uri,
      hasAudio: aggregated.hasAudio,
      audioWarnings: aggregated.audioWarnings,
      duration: total,
      timings: slowest?.timings,
      phases: {
        totalMs: Date.now() - startedAt,
        concatMs,
        ...(aggregated.haveFixedCosts
          ? {
              pageLoadTotalMs: aggregated.phasePageLoadMs,
              firstFrameTotalMs: aggregated.phaseFirstFrameMs,
              audioPrepTotalMs: aggregated.phaseAudioPrepMs,
            }
          : {}),
      },
      perfWarnings: aggregated.perfWarnings,
      visualWarnings: aggregated.visualWarnings,
      encoder: runEncoder,
      ...(shots.length > 0
        ? {
            incremental: {
              shots: shots.length,
              renderedSegments,
              reusedSegments,
            },
          }
        : {}),
      warnings,
      clips,
      editorPackage: {
        directoryUri: packageDir.uri,
        fps,
        width: size.width,
        height: size.height,
      },
    };
  } finally {
    if (!keepPackage) {
      try {
        packageDir.delete();
      } catch {
        // Best-effort cleanup of a failed export's derived clips.
      }
    }
  }
}

/** `Intro: Hook!` -> `intro-hook`; safe as an album/zip file name. */
function clipFileSlug(label: string, index: number) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `clip-${index + 1}`;
}

type SegmentSidecar = {
  hasAudio?: boolean;
  audioWarnings?: string[];
  perfWarnings?: string[];
  visualWarnings?: string[];
  encoder?: string;
  /** Encoder profile that produced the footage; see `RenderProfile.id`. */
  profile?: string;
  /** Which kind of backend produced it, for diagnostics only. */
  origin?: "device" | "remote";
};

function adoptSidecar(aggregated: Aggregated, meta: SegmentSidecar | null) {
  aggregated.hasAudio = aggregated.hasAudio || meta?.hasAudio === true;
  if (Array.isArray(meta?.audioWarnings)) aggregated.audioWarnings.push(...meta.audioWarnings);
  if (Array.isArray(meta?.perfWarnings)) aggregated.perfWarnings.push(...meta.perfWarnings);
  if (Array.isArray(meta?.visualWarnings)) {
    for (const note of meta.visualWarnings) addVisualWarning(aggregated, note);
  }
}

/** Folds one fresh segment into the run totals; returns its timings (if any). */
function adoptResult(
  aggregated: Aggregated,
  result: {
    hasAudio: boolean;
    audioWarnings: string[];
    perfWarnings?: string[];
    visualWarnings?: string[];
    encoder?: string;
    timings?: VideoExportTimings;
  },
): VideoExportTimings | undefined {
  aggregated.hasAudio = aggregated.hasAudio || result.hasAudio;
  aggregated.audioWarnings.push(...result.audioWarnings);
  aggregated.perfWarnings.push(...(result.perfWarnings ?? []));
  for (const note of result.visualWarnings ?? []) addVisualWarning(aggregated, note);
  if (result.encoder && !aggregated.encoder) aggregated.encoder = result.encoder;
  const timings = result.timings;
  if (!timings) return undefined;
  // Fixed-cost attribution: summed per fresh segment so the run's numbers
  // expose the per-segment overheads (boot, first-frame setup, whole-file
  // audio re-decode) instead of one segment's sample.
  if (timings.pageLoadMs != null || timings.firstFrameMs != null || timings.audioPrepMs != null) {
    aggregated.haveFixedCosts = true;
    aggregated.phasePageLoadMs += timings.pageLoadMs ?? 0;
    aggregated.phaseFirstFrameMs += timings.firstFrameMs ?? 0;
    aggregated.phaseAudioPrepMs += timings.audioPrepMs ?? 0;
  }
  return timings;
}

function addVisualWarning(aggregated: Aggregated, note: string) {
  if (!aggregated.visualWarnings.includes(note)) aggregated.visualWarnings.push(note);
}

function buildPhases(
  merged: {
    totalMs: number;
    concatMs?: number;
    aggregated: Aggregated;
  },
  includeConcat: boolean,
) {
  const { aggregated } = merged;
  return {
    totalMs: merged.totalMs,
    ...(includeConcat && merged.concatMs != null ? { concatMs: merged.concatMs } : {}),
    ...(aggregated.haveFixedCosts
      ? {
          pageLoadTotalMs: aggregated.phasePageLoadMs,
          firstFrameTotalMs: aggregated.phaseFirstFrameMs,
          audioPrepTotalMs: aggregated.phaseAudioPrepMs,
        }
      : {}),
  };
}

/** `id:hash` fingerprints -> one stable cache token for a segment. */
export function hashSegmentKeys(keys: string[]): string {
  return hashDocumentKey(uniqueSorted(keys).join("\n"));
}

/**
 * Drops same-scene segment files that this run did not use. Scoped to the
 * shared hash, so a shared-code edit starts a fresh namespace and the old
 * namespace's files age out with the OS cache instead of being deleted while
 * another revision might still be resuming them.
 */
async function pruneSceneSegments(namespace: string, keep: Set<string>) {
  try {
    const directory = new Directory(Paths.cache);
    const prefix = `render-${namespace}-`;
    for (const entry of directory.list()) {
      const name = entry.name;
      if (!name.startsWith(prefix) || keep.has(name) || name.endsWith("-full.mp4")) continue;
      try {
        entry.delete();
      } catch {
        // Best-effort cache cleanup.
      }
    }
  } catch {
    // Cache listing is unavailable in some test/embedded environments.
  }
}

/**
 * Stable cache key for a document's segment-resume files. Exports are
 * deterministic in the document, so a retry of the same HTML legitimately
 * reuses finished segments and an edit must not. Pure FNV-1a over the document
 * (truncated) — this guards a cache directory name, not security.
 */
export function hashDocumentKey(documentHtml: string): string {
  // FNV-1a 32-bit, chunked so a multi-megabyte document does not build parts.
  let hash = 0x811c9dc5;
  const CHUNK = 0x8000;
  for (let i = 0; i < documentHtml.length; i += CHUNK) {
    const slice = documentHtml.slice(i, i + CHUNK);
    for (let j = 0; j < slice.length; j += 1) {
      hash ^= slice.charCodeAt(j);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `hash-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
