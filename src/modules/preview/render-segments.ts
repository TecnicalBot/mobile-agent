import { Directory, File, Paths } from "expo-file-system";

import {
  type VideoExportTimings,
  type VideoRenderPlan,
  probeVideoPlan,
  requestVideoRender,
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
  contractDuration: number | null;
  documentHtml: string;
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

  // A probe costs one page boot, so only scenes that look shot-structured
  // pay it. A false positive is harmless: the page reports no shots and the
  // legacy path runs unchanged.
  if (/\bshots\s*:/.test(documentHtml)) {
    let plan: VideoRenderPlan | null = null;
    try {
      plan = await probeVideoPlan(documentHtml, { signal: abortSignal });
    } catch {
      // A probe is an optimization, never a gate. Fall through to the legacy
      // path; the actual render will surface any real page failure.
      plan = null;
    }
    if (plan && plan.shots.length > 0) {
      return renderPlannedTimeline({
        abortSignal,
        documentHtml,
        onProgress,
        plan,
      });
    }
  }

  return renderLegacyTimeline({
    abortSignal,
    contractDuration,
    documentHtml,
    onProgress,
    sourceFileId: options.sourceFileId,
  });
}

async function renderLegacyTimeline(options: {
  abortSignal?: AbortSignal;
  contractDuration: number | null;
  documentHtml: string;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
  sourceFileId: string;
}): Promise<SegmentRenderResult> {
  const { abortSignal, contractDuration, documentHtml, onProgress, sourceFileId } = options;

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
    return requestVideoRender(documentHtml, {
      signal: abortSignal,
      onProgress: (progress) => reportProgress(weight.base, weight.span, progress),
      segment: segment,
      progressBase: weight.base,
      progressSpan: weight.span,
      pinnedEncoder,
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
  const sidecar = (index: number, offset: number, length: number) =>
    new File(Paths.cache, `render-${sourceFileId}-seg-${index}-${offset}-${length}.json`);

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
    let runEncoder: string | undefined;
    let slowest: { timings?: VideoExportTimings; cost: number } | null = null;
    const uris: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const offset = i * SEGMENT_SECONDS;
      const length = Math.min(SEGMENT_SECONDS, total - offset);
      const segFile = new File(Paths.cache, `render-${sourceFileId}-seg-${i}-${offset}-${length}.mp4`);
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
          }),
        );
      } catch {
        // Sidecar is resume metadata only; footage is already safe.
      }
      uris.push(segFile.uri);
    }

    const outFile = new File(Paths.cache, `render-${sourceFileId}-full.mp4`);
    const { getHtmlVideoExportModule } = await import("html-video-export");
    const module = getHtmlVideoExportModule();
    if (!module || typeof module.concatSegments !== "function") {
      throw new Error("Segmented rendering needs the video export module (concatSegments).");
    }
    reportProgress(0, 1, 1);
    const concatStartedAt = Date.now();
    try {
      await module.concatSegments(uris.map(stripScheme), stripScheme(outFile.uri));
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
  documentHtml: string;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
  plan: VideoRenderPlan;
}): Promise<SegmentRenderResult> {
  const { abortSignal, documentHtml, onProgress, plan } = options;
  const total = plan.duration;
  const segments = planShotSegments(total, plan.shots);
  const namespace = plan.sharedHash;
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
  let runEncoder: string | undefined;
  let slowest: { timings?: VideoExportTimings; cost: number } | null = null;
  let renderedSegments = 0;
  let reusedSegments = 0;

  const reportProgress = (base: number, span: number, segProgress: number) => {
    const overall = span <= 0 ? 0 : Math.max(0, Math.min(1, base + segProgress * span));
    onProgress?.({ bytesWritten: Math.min(9900, Math.floor(overall * 9900)), totalBytes: 10000 });
  };
  const runOne = (
    segment: { offset: number; length: number },
    weight: { base: number; span: number },
    pinnedEncoder?: string,
  ) =>
    requestVideoRender(documentHtml, {
      signal: abortSignal,
      onProgress: (progress) => reportProgress(weight.base, weight.span, progress),
      segment,
      progressBase: weight.base,
      progressSpan: weight.span,
      pinnedEncoder,
    });

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

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
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
        meta && typeof meta.encoder === "string" && meta.encoder ? meta.encoder : undefined;
      if (!runEncoder || !cachedEncoder || cachedEncoder === runEncoder) {
        if (cachedEncoder) runEncoder = cachedEncoder;
        uris.push(segFile.uri);
        adoptSidecar(aggregated, meta);
        reusedSegments += 1;
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

    let result;
    try {
      result = await runOne(
        { offset: segment.offset, length: segment.length },
        { base: segment.offset / total, span: segment.length / total },
        runEncoder,
      );
    } catch (error) {
      throw new Error(
        `Segment ${i + 1}/${segments.length} (t=${segment.offset}-${Math.round((segment.offset + segment.length) * 100) / 100}s) failed: ${error instanceof Error ? error.message : String(error)}. Re-run to resume — finished segments are kept.`,
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
      await sidecar.write(
        JSON.stringify({
          hasAudio: result.hasAudio,
          audioWarnings: result.audioWarnings,
          perfWarnings: result.perfWarnings ?? [],
          visualWarnings: aggregated.visualWarnings,
          encoder: result.encoder,
        }),
      );
    } catch {
      // Sidecar is cache metadata only; footage is already safe.
    }
    uris.push(segFile.uri);
    renderedSegments += 1;
  }

  const outFile = new File(Paths.cache, `render-${namespace}-full.mp4`);
  const { getHtmlVideoExportModule } = await import("html-video-export");
  const module = getHtmlVideoExportModule();
  if (!module || typeof module.concatSegments !== "function") {
    throw new Error("Segmented rendering needs the video export module (concatSegments).");
  }
  reportProgress(0, 1, 1);
  const concatStartedAt = Date.now();
  try {
    await module.concatSegments(uris.map(stripScheme), stripScheme(outFile.uri));
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

type SegmentSidecar = {
  hasAudio?: boolean;
  audioWarnings?: string[];
  perfWarnings?: string[];
  visualWarnings?: string[];
  encoder?: string;
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

/** `file://` URIs -> plain paths for the native concatenator. */
function stripScheme(uri: string) {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
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
