/**
 * Segment rendering: load the scene, step `render(t)` at 1/fps, encode.
 *
 * Because `render(t)` is a pure function of `t`, frames are stepped as fast as
 * the encoder accepts them instead of in real time. On a GPU box a 45 s segment
 * is a few seconds of wall clock.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { once } from "node:events";

const RUNTIME = readFileSync(new URL("./runtime.js", import.meta.url), "utf8");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inject the harness right before </body>, like the device's recorder does. */
export function buildDocument(html) {
  const script = `<script>${RUNTIME}</script>`;
  const bodyEnd = html.toLowerCase().lastIndexOf("</body>");
  if (bodyEnd >= 0) return html.slice(0, bodyEnd) + script + html.slice(bodyEnd);
  return html + script;
}

function vaapiDevice() {
  return process.env.MA_VAAPI_DEVICE || "/dev/dri/renderD128";
}

/** Encoder-specific quality flags. Bitrate is left to the encoder's quality mode. */
export function encoderArgs(encoder) {
  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc" || encoder === "av1_nvenc") {
    // NVENC at a fixed CQ is softer than x264 on flat canvas content; 19 keeps
    // text edges clean without ballooning the file.
    return ["-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "19", "-b:v", "0"];
  }
  if (encoder === "h264_qsv" || encoder === "hevc_qsv" || encoder === "av1_qsv") {
    return ["-preset", "veryfast", "-global_quality", "20"];
  }
  if (encoder === "h264_amf" || encoder === "hevc_amf") {
    return ["-quality", "balanced", "-rc", "vbr_peak", "-qp_i", "20", "-qp_p", "20"];
  }
  if (encoder === "h264_videotoolbox" || encoder === "hevc_videotoolbox") {
    return ["-q:v", "55"];
  }
  if (encoder.endsWith("_vaapi")) {
    return ["-quality", "5"];
  }
  throw new Error(`No quality profile for encoder "${encoder}".`);
}

function ffmpegCommand({ encoder, fps, outPath }) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  const vaapi = encoder.endsWith("_vaapi");
  if (vaapi) args.push("-vaapi_device", vaapiDevice());
  args.push("-f", "image2pipe", "-framerate", String(fps), "-i", "-");

  // The input is MJPEG, which is full-range by convention, so ffmpeg happily
  // propagates yuvj420p into the output. The device encodes limited-range
  // yuv420p; without this conversion the two look different after a concat and
  // the profile claim ("yuv420p") would be a lie.
  const normalize = "scale=in_range=full:out_range=limited";
  if (vaapi) {
    args.push("-vf", `${normalize},format=nv12,hwupload`);
  } else {
    args.push("-vf", `${normalize},format=yuv420p`);
  }

  args.push("-c:v", encoder, ...encoderArgs(encoder), "-pix_fmt", "yuv420p", "-an");
  args.push("-movflags", "+faststart", outPath);
  return args;
}

export async function waitForHarness(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(
      "typeof window.__maReady === 'function' && window.__maReady()",
    );
    if (ready) return;
    await sleep(50);
  }
  throw new Error("The scene never defined window.MOBILE_AGENT_VIDEO.");
}

/**
 * Render `[segment.offset, segment.offset + segment.length)` into `outPath`.
 * Resolves with the plan actually used (the page is the source of truth).
 */
export async function renderSegment(options) {
  const {
    page,
    html,
    segment,
    encoder,
    outPath,
    signal,
    onProgress,
    jpegQuality = 0.92,
    capture = process.env.MA_RENDER_CAPTURE || "canvas",
  } = options;

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const { frameTree } = await page.send("Page.getFrameTree");
  await page.send("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: buildDocument(html),
  });
  await waitForHarness(page);

  // The plan comes from the page, so width/height/fps are the ones the scene
  // will actually draw, not the ones the caller assumed.
  const plan = await page.evaluate("window.__maPlan()");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: plan.width,
    height: plan.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.evaluate("window.__maSetup()");

  const start = Math.max(0, segment?.offset ?? 0);
  const length = Math.max(0, segment?.length ?? plan.duration);
  const count = Math.max(1, Math.round(length * plan.fps));

  const child = spawn("ffmpeg", ffmpegCommand({ encoder, fps: plan.fps, outPath }), {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
  });
  const exited = once(child, "exit").then(([code]) => code);

  const fail = async (error) => {
    try {
      child.stdin.destroy();
    } catch {
      // Already closed.
    }
    child.kill("SIGKILL");
    await exited.catch(() => {});
    throw error;
  };

  try {
    for (let i = 0; i < count; i += 1) {
      if (signal?.aborted) throw new Error("Render cancelled.");
      const t = start + i / plan.fps;

      let base64;
      try {
        if (capture === "screenshot") {
          // Render, then let the compositor encode the frame. One extra round
          // trip, but the JPEG is produced natively instead of in JS.
          await page.evaluate(`window.__maFrame(${t})`, { timeoutMs: 60_000 });
          const shot = await page.send("Page.captureScreenshot", {
            format: "jpeg",
            quality: Math.round(jpegQuality * 100),
            optimizeForSpeed: true,
            fromSurface: true,
            captureBeyondViewport: false,
          });
          base64 = shot.data;
        } else {
          base64 = await page.evaluate(
            `window.__maCapture(${t}, ${jpegQuality})`,
            { timeoutMs: 60_000 },
          );
        }
      } catch (error) {
        throw new Error(`Frame ${i} (t=${t.toFixed(3)}s) failed: ${error.message}`);
      }

      const frame = Buffer.from(base64, "base64");
      if (!child.stdin.write(frame)) await once(child.stdin, "drain");
      onProgress?.((i + 1) / count);
    }

    child.stdin.end();
    const code = await exited;
    if (code !== 0) {
      throw new Error(`ffmpeg exited with ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
    }
  } catch (error) {
    await fail(error);
  }

  return { plan, frames: count, encoder };
}
