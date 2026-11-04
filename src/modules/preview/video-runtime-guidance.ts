/** Shipped with the renderer, not downloaded: old installed skills cannot
 * teach a media contract that conflicts with the running app. Never rewrites
 * the user's installed/customized skill document. */
export const VIDEO_RUNTIME_GUIDANCE = `## Current video runtime requirements (v2)

These requirements supersede conflicting timing/audio advice in older installed html-video skills.

- Same-chat follow-ups reuse the loaded skill, prior media inspections, and saved transcripts/analysis. Do not reload the skill, re-open the same video timestamps, or re-transcribe unchanged audio on every prompt. Read saved result JSON when needed; inspect only new/missing information. Transcription is not required to preserve source audio or change visual layout.
- render(t, canvas, ctx) only draws already-decoded frames. Never assign video.currentTime, call play(), or start async media work inside render(). The exporter fails if render changes a prepared video frame.
- Declare MOBILE_AGENT_VIDEO.shots as 2–8 non-overlapping story beats ({ id, start, end, render }) for ANY video with two or more distinct beats — including the first render, not only after the user asks for a revision. Without shots the whole timeline re-renders on every edit. Each shot owns [start, end) and renders frames in its window; the top-level render covers gaps. Export, previewScene, and the in-app player all dispatch to the owning shot. Editing one shot re-encodes only the segments containing it; editing shared helpers/assets/clips/the audio schedule or the top-level render invalidates every segment. Keep shot ids and windows stable across revisions so footage is reused; the render result's incremental field reports rendered vs reused segments.
- Declare EVERY video in MOBILE_AGENT_VIDEO.clips. A full-length base is { el: '#base', start: 0, end: duration, from: 0 }. Repeated person overlays reuse one element with NON-OVERLAPPING windows, e.g. { el: '#person', start: 18, end: 33, from: 0 }, { el: '#person', start: 63, end: 78, from: 0 }. Each appearance restarts at source zero; never use global t % sourceDuration. The runtime seeks and awaits decoding before render. Use separate elements for overlapping appearances.
- Video elements must be muted, playsinline, preload="auto", kept in the DOM (opacity:0/offscreen, not display:none). Guard drawing with readyState >= 2 and videoWidth. For chroma key, drawKeyed only draws; the clip timeline owns seeking. Do not silently ignore a false drawKeyed result.
- An edited video must preserve the ORIGINAL MAIN VIDEO soundtrack unless the user requests silence/replacement. Set audio: { master: 1, tracks: [{ file: "workspace://<actual-main-video-id>", start: 0, offset: 0, duration: duration, volume: 1 }] }. MP4/MOV/WebM video files are accepted as audio sources; a separate audio extraction tool is unnecessary. Do not mix overlay audio unless requested. Muted video elements do NOT contribute sound to export. Video scenes without a schedule must explicitly set audio: false for intentional silence; missing/empty schedules fail rather than silently dropping source sound.
- Before a long render, batch previewScene times at EACH overlay's start/middle/end and around 30s segment seams (up to 12 per call; default is ONE timestamp-labeled contact sheet). previewMix checks the scheduled soundtrack. After export, batch getVideoFrame with times: [first, middle, last] to inspect ONE contact sheet directly, without separate reads. Use getVideoFrame time or previewScene layout: frames only for full-resolution detail checks. Confirm hasAudio; do not claim all overlays/audio are correct from the first frame alone.
- Revisions must read and correct the saved .source.html, then re-render; re-exporting the same broken source does not repair it.
- Never automatically restart a failed/stalled export or join. Report the error and let the user decide whether to retry; completed segments are retained. 100% means the output has successfully finished, not merely that the final segment was encoded.
`;

export function withVideoRuntimeGuidance(skill: {
  title: string;
  instructions: string;
}): string {
  const title = skill.title.trim().toLowerCase().replace(/[ _]+/g, "-");
  if (title !== "html-video" && !skill.instructions.includes("MOBILE_AGENT_VIDEO")) {
    return skill.instructions;
  }
  return `${VIDEO_RUNTIME_GUIDANCE}\n---\n\n${skill.instructions}`;
}
