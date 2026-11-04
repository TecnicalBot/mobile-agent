import { requestScenePreview, type ScenePreviewFrame } from "@/modules/preview/video-preview";

export const MAX_CONTACT_SHEET_FRAMES = 12;

/** Bounded thumbnails, not a grid of full-resolution images sent to vision. */
export function buildContactSheetDocument(frames: ScenePreviewFrame[]): string {
  if (!frames.length || frames.length > MAX_CONTACT_SHEET_FRAMES) {
    throw new Error("A contact sheet needs 1–12 frames.");
  }
  const columns = Math.min(frames.length, frames.length <= 6 ? 3 : 4);
  const cellWidth = 320;
  const cellHeight = 240;
  const labelHeight = 28;
  const width = columns * cellWidth;
  const height = Math.ceil(frames.length / columns) * (cellHeight + labelHeight);
  for (const frame of frames) {
    if (!Number.isFinite(frame.time) || !/^[A-Za-z0-9+/=]+$/.test(frame.base64)) {
      throw new Error("Invalid contact sheet frame.");
    }
  }
  return `<!doctype html><html><body>
<canvas id="sheet" width="${width}" height="${height}"></canvas>
${frames.map((f, i) => `<img style="display:none" id="f${i}" src="data:image/jpeg;base64,${f.base64}">`).join("")}
<script>window.MOBILE_AGENT_VIDEO = { duration: 1, canvasId: 'sheet', render: function(t, canvas, ctx) {
ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.font = '18px sans-serif'; ctx.textBaseline = 'middle';
${frames.map((f, i) => {
    const x = (i % columns) * cellWidth;
    const y = Math.floor(i / columns) * (cellHeight + labelHeight);
    return `var img = document.getElementById('f${i}');
if (!img.complete || !img.naturalWidth) throw new Error('Contact sheet image failed to load');
var scale = Math.min(${cellWidth} / img.naturalWidth, ${cellHeight} / img.naturalHeight, 1);
var w = img.naturalWidth * scale, h = img.naturalHeight * scale;
ctx.drawImage(img, ${x} + (${cellWidth} - w) / 2, ${y} + (${cellHeight} - h) / 2, w, h);
ctx.fillStyle = '#ffffff'; ctx.fillText('${i + 1}. ${f.time}s', ${x + 8}, ${y + cellHeight + labelHeight / 2});`;
  }).join("\n")}
} };</script></body></html>`;
}

export async function createContactSheet(frames: ScenePreviewFrame[], signal?: AbortSignal) {
  const result = await requestScenePreview(buildContactSheetDocument(frames), { times: [0], signal });
  if (!result.frames.length || result.warnings.length) {
    throw new Error(`Contact sheet capture failed. ${result.warnings.join(" ")}`);
  }
  return result.frames[0];
}
