/**
 * Job-level failure bounds for the preview/mix/render WebView lanes, in one
 * place so every clock's value and its error message stay in step and the
 * calibrated pairs stay calibrated (a start grace must fit inside the job
 * budget it guards).
 *
 * What these bounds are NOT: they are not activity deadlines by themselves —
 * the host components own the timers; here live the numbers, the derivation,
 * and the messages. Fixed timers never gate decode/analysis steps; every
 * message path is event-driven and these bounds only cap *loud failure*, so
 * a healthy job that legitimately needs the budget always finishes.
 *
 * The shared reasoning behind the 60 s / 180 s pair (research, not guesses):
 *
 * - Served soundtracks stream up to 200 MB, and `decodeAudioData`
 *   materializes the whole file as float32 PCM. A slow-compressed 200 MB MP3
 *   is hours of audio — gigabytes of float32 — so that class of file dies of
 *   *memory* first (the renderer is killed and the job rejects loudly via
 *   `onRenderProcessGone`, already handled). Wall time is only the binding
 *   constraint for files that fit memory, and those decode in minutes at the
 *   very worst even at ~10x realtime.
 * - `OfflineAudioContext.startRendering()` allocates its entire output
 *   AudioBuffer up front (Microsoft Edge's WebAudio incremental-rendering
 *   explainer documents this: "startRendering() allocates an AudioBuffer
 *   large enough to hold the entire rendered WebAudio graph before
 *   returning"). The mix check therefore renders the timeline in 45 s
 *   windows (~17 MB of stereo float32 each) rather than one full-length
 *   buffer, which would be ~230 MB at the 600 s scene limit. Per-window
 *   render + level math is seconds, and the windows reuse one whole-file
 *   decode per soundtrack — that decode is the dominant cost in a mix job,
 *   and total window count is the only thing that grows with duration.
 *
 * 180 s therefore covers fetch + decode (of files that fit renderer memory;
 * bigger ones die of memory loudly first via `onRenderProcessGone`) plus
 * every window's offline render and level math, with headroom.
 */

export const SCENE_PREVIEW_START_TIMEOUT_MS = 15_000;
export const SCENE_PREVIEW_JOB_TIMEOUT_MS = 60_000;
export const MIX_JOB_TIMEOUT_MS = 180_000;
export const RENDER_PAGE_SILENCE_MS = 180_000;

/** One-line diagnostics captured into every bound-derived error message. */
export function describeJobDetails(html: string): string {
  return `${html.length}-char document`;
}

const seconds = (ms: number) => Math.round(ms / 1000);

export function describeScenePreviewJob(job: {
  html: string;
  times: number[];
}): string {
  const count = job.times.length;
  return `${count} timestamp${count === 1 ? "" : "s"}, ${job.html.length}-char document`;
}

/** The preview page never posted back (load failed or bridge never started). */
export function scenePreviewStartTimeoutError(job: {
  html: string;
  times: number[];
}): Error {
  const bound = seconds(SCENE_PREVIEW_START_TIMEOUT_MS);

  return new Error(
    `Scene preview failed: the preview page did not start within ${bound}s ` +
      `(${describeScenePreviewJob(job)}). The WebView may have failed to load — ` +
      `try a smaller document or fewer timestamps.`,
  );
}

/** The preview page started but never finished all timestamps. */
export function scenePreviewJobTimeoutError(
  job: { html: string; times: number[] },
  framesCaptured: number,
): Error {
  const bound = seconds(SCENE_PREVIEW_JOB_TIMEOUT_MS);
  return new Error(
    `Scene preview timed out after ${bound}s ` +
      `(${framesCaptured}/${job.times.length} frames captured, ${describeScenePreviewJob(job)}). ` +
      `Try fewer timestamps or a smaller document.`,
  );
}

/** The mix page never finished the fetch/decode/render pipeline. */
export function mixJobTimeoutError(job: {
  html: string;
}): Error {
  return new Error(
    `Mix check timed out after ${seconds(MIX_JOB_TIMEOUT_MS)}s (${describeJobDetails(job.html)}). ` +
      `Try a smaller audio schedule or shorter tracks.`,
  );
}

/** The render page posted nothing for the whole silence bound. */
export function renderPageInactivityError(details: {
  progressPercent: number;
  html: string;
  segment: string | null;
}): Error {
  const where = details.segment ? `, ${details.segment}` : "";
  return new Error(
    `Video render stalled: no page activity for ${seconds(RENDER_PAGE_SILENCE_MS)}s ` +
      `(last progress ${details.progressPercent}%${where}, ${describeJobDetails(details.html)}). ` +
      `The export page may have hung; finished segments resume on retry.`,
  );
}
