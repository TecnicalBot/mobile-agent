/**
 * What this box can actually encode.
 *
 * The app refuses a target whose best option is software (see
 * `requireHardwareEncoding` in `src/modules/preview/render-backend.ts`), so this
 * must be honest: listing an encoder that exists but cannot open is worse than
 * reporting none. Every candidate is therefore proven with a real 0.5 s encode,
 * not just `ffmpeg -encoders`.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Mirrors HARDWARE_ENCODERS in the app; keep the two lists in step. */
export const HARDWARE_ENCODERS = [
  "h264_nvenc",
  "h264_videotoolbox",
  "h264_qsv",
  "h264_amf",
  "h264_vaapi",
  "hevc_nvenc",
  "hevc_videotoolbox",
  "hevc_qsv",
  "hevc_amf",
  "hevc_vaapi",
  "av1_nvenc",
];

/** Preference order: H.264 first, because the app's profiles are H.264. */
const PREFERENCE = new Map(HARDWARE_ENCODERS.map((name, index) => [name, index]));

function findVaapiDevice() {
  if (existsSync("/dev/dri/renderD128")) return "/dev/dri/renderD128";
  try {
    const entry = readdirSync("/dev/dri").find((name) => name.startsWith("renderD"));
    return entry ? `/dev/dri/${entry}` : null;
  } catch {
    return null;
  }
}

async function ffmpegEncoders() {
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-encoders"], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const found = new Set();
    for (const line of stdout.split("\n")) {
      const match = /^\s*[A-Z.]{6}\s+(\S+)\s+/.exec(line);
      if (match && PREFERENCE.has(match[1])) found.add(match[1]);
    }
    return [...found];
  } catch {
    return [];
  }
}

/**
 * Prove one encoder can open and produce a frame. A 0.5 s 320x180 test pattern
 * is enough to catch a missing driver, a busy NVENC session, or a VAAPI device
 * without permission.
 */
async function canEncode(encoder) {
  const args = ["-hide_banner", "-loglevel", "error"];
  const vaapi = encoder.endsWith("_vaapi");
  const device = vaapi ? findVaapiDevice() : null;
  if (vaapi) {
    if (!device) return { ok: false, reason: "no /dev/dri render node" };
    args.push("-vaapi_device", device);
  }
  args.push("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=0.5");
  if (vaapi) args.push("-vf", "format=nv12,hwupload");
  args.push("-c:v", encoder, "-f", "null", "-");

  try {
    await run("ffmpeg", args, { timeout: 20_000, maxBuffer: 1024 * 1024 });
    return { ok: true };
  } catch (error) {
    const stderr = String(error?.stderr ?? error?.message ?? "").trim();
    return { ok: false, reason: stderr.split("\n").slice(-1)[0] || "encode failed" };
  }
}

async function detectGpu() {
  try {
    const { stdout } = await run(
      "nvidia-smi",
      ["--query-gpu=name,driver_version", "--format=csv,noheader"],
      { timeout: 5_000 },
    );
    const [name, driver] = stdout.trim().split(",").map((part) => part.trim());
    if (name) return { vendor: "nvidia", name, driver };
  } catch {
    // No NVIDIA tooling; fall through to the DRM vendor table.
  }

  const vendors = { "0x10de": "nvidia", "0x8086": "intel", "0x1002": "amd", "0x13b5": "arm" };
  try {
    for (const card of readdirSync("/sys/class/drm")) {
      if (!/^card\d+$/.test(card)) continue;
      const raw = readFileSync(`/sys/class/drm/${card}/device/vendor`, "utf8").trim();
      const vendor = vendors[raw];
      if (vendor) return { vendor, name: `${vendor} GPU (${card})` };
    }
  } catch {
    // Headless box with no DRM nodes.
  }

  if (process.platform === "darwin") {
    try {
      const { stdout } = await run("system_profiler", ["SPDisplaysDataType"], { timeout: 15_000 });
      const name = /Chipset Model:\s*(.+)/.exec(stdout)?.[1]?.trim();
      if (name) return { vendor: "apple", name };
    } catch {
      // Ignore: macOS without system_profiler is not a real configuration.
    }
  }

  return null;
}

let cached = null;

/**
 * Detect once per process. `canvas` is filled in by the Chromium probe in
 * `service.mjs`; it starts as "unknown" so a caller can tell "not measured yet"
 * from "measured and software".
 */
export async function detectCapabilities() {
  if (cached) return cached;

  const present = await ffmpegEncoders();
  const ordered = [...present].sort(
    (a, b) => (PREFERENCE.get(a) ?? 99) - (PREFERENCE.get(b) ?? 99),
  );

  const proven = [];
  const rejected = [];
  for (const encoder of ordered) {
    const result = await canEncode(encoder);
    if (result.ok) proven.push(encoder);
    else rejected.push({ encoder, reason: result.reason });
  }

  const gpu = await detectGpu();
  cached = {
    encoders: proven,
    preferred: proven[0] ?? null,
    hardware: proven.length > 0,
    gpu: gpu ?? undefined,
    canvas: "unknown",
    rejected,
  };
  return cached;
}

/** Called by the Chromium probe once the real renderer is known. */
export function setCanvasMode(mode) {
  if (cached) cached.canvas = mode;
}
