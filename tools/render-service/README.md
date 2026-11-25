# Render service

A GPU render node for the app's video pipeline. It loads a scene's HTML in
headless Chrome, steps `render(t)` frame by frame, pipes the frames into ffmpeg,
and returns an H.264 MP4 segment — typically several times faster than the
phone can record it.

The app treats this exactly like its own recorder: it asks for a segment
boundary, downloads one MP4, and keeps it in the same on-device cache. Because
`render(t)` is a pure function of `t`, frames here are stepped as fast as the
encoder accepts them rather than in real time.

```
phone ──POST /v1/render {html, offset, length}──▶ chrome ──frames──▶ ffmpeg (NVENC)
   ◀───────────────── video/mp4 ─────────────────┘
   └─ writes into Paths.cache, reuses it on the next revision
```

Design and rationale: [`docs/remote-render.md`](../../docs/remote-render.md).

---

## Status

Working today:

- Probe (`/v1/probe`) returning the same `sharedHash` / shot hashes as the device.
- Segment rendering to H.264, `yuv420p`, limited range (TV), matching the
  device's pixel format so segments can concat.
- Hardware encoder detection with a real encode proof, and refusal to start
  without one.
- Parallel jobs, backpressure, abort/cancel, client-disconnect cancellation.

Not supported yet (v1 fails loudly rather than producing a wrong file):

- **Audio.** A scene with an `audio` schedule is rejected. A scene that omits
  `audio` is also rejected, so silence is never accidental.
- **Video clips.** Any `<video>` in the document is rejected: there is no
  workspace asset transport yet, so the node cannot reach the phone's files.
- Images work only if they are inlined or reachable over the network; the
  phone's `http://127.0.0.1:…` asset URLs are not reachable from this box.

Both blockers need asset transport (push per job, or pull from the phone over
LAN/Tailnet) — see `docs/remote-render.md` §5 "Assets".

---

## Requirements

| Component | Version | Notes |
|---|---|---|
| Node | ≥ 22 | Uses the global `WebSocket`; no npm dependencies |
| ffmpeg | ≥ 6 | Needs the target vendor's encoder compiled in |
| Chrome / Chromium | any recent | `CHROME_PATH` if not in a standard location |
| GPU driver | current | See per-vendor notes below |

There is nothing to `npm install`. Copy this directory to the render box, or run
it from a checkout.

---

## Quick start

```bash
# always test the encoder lane first — a present encoder that cannot open is
# the most common failure, and the service will refuse to start
ffmpeg -hide_banner -f lavfi -i testsrc2=size=320x180:rate=30:duration=1 \
  -c:v h264_nvenc -f null -

node tools/render-service/service.mjs
```

You should see:

```
capabilities: encoder=h264_nvenc gpu=NVIDIA GeForce RTX 5060
canvas: gpu (ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5060/PCIe/SSE2, OpenGL 4.5.0))
render service on http://127.0.0.1:8787 (concurrency 4)
```

Smoke test:

```bash
curl -s localhost:8787/v1/health
curl -s localhost:8787/v1/capabilities | jq

curl -s localhost:8787/v1/probe \
  -H 'content-type: application/json' \
  -d "$(jq -Rs '{html: .}' tools/render-service/examples/smoke.html)" | jq

curl -s localhost:8787/v1/render \
  -H 'content-type: application/json' \
  -d "$(jq -Rs '{html: ., offset: 0, length: 4}' tools/render-service/examples/smoke.html)" \
  -o /tmp/smoke.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,color_range,nb_frames \
  -of default=nw=1 /tmp/smoke.mp4
```

Expect `h264`, `640x360`, `yuv420p`, `tv`, and `nb_frames=120`.

---

## GPU setup

The service proves each encoder with a real 0.5 s encode before trusting it. If
none can open, it exits with a message rather than fall back to the CPU.

### NVIDIA (NVENC)

- Needs a GTX 10-series or newer, or any Quadro/Tesla with NVENC.
- `h264_nvenc` is preferred; `hevc_nvenc` / `av1_nvenc` are listed when the GPU
  supports them.
- On Linux, headless Chrome needs either a display or a working DRM node. If
  the canvas probe reports `cpu`, add `--use-gl=egl` via `MA_RENDER_CHROME_FLAGS`
  (see below) and make sure `nvidia-drm.modeset=1` is set.
- In a container: `--gpus all` and
  `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility`.
- Consumer cards cap concurrent NVENC sessions (historically 2–3, newer drivers
  5–8). `MA_RENDER_CONCURRENCY` above that will serialize in the driver; check
  the startup log and the machine's session limit.

### Intel Quick Sync

- `h264_qsv` / `hevc_qsv`. Needs `/dev/dri` inside a container:
  `--device=/dev/dri` and membership in the `video` group.
- VAAPI is the fallback lane on Intel (`h264_vaapi`).

### AMD (Linux, VAAPI)

- `h264_vaapi`, using `/dev/dri/renderD128` by default; override with
  `MA_VAAPI_DEVICE`.
- Frames are uploaded with `format=nv12,hwupload` before encoding.
- Needs `libva` and the Mesa/VCN driver, plus `video` group access.

### AMD (Windows, AMF)

- `h264_amf` / `hevc_amf`; no special device flag.

### Apple Silicon / Mac

- `h264_videotoolbox` / `hevc_videotoolbox`; no special flags.
- Chrome binary is `Google Chrome.app/Contents/MacOS/Google Chrome` (found
  automatically).

### No GPU

Buy one, rent one, or start with `MA_ALLOW_SOFTWARE=1` for debugging only. The
app refuses targets whose best encoder is software (`requireHardwareEncoding`),
because CPU encoding is slower than the phone and no cheaper.

---

## Configuration

All configuration is environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `MA_RENDER_PORT` | `8787` | Listen port |
| `MA_RENDER_HOST` | `127.0.0.1` | Listen address. Set `0.0.0.0` for LAN, then use a token |
| `MA_RENDER_TOKEN` | *(empty)* | Require `Authorization: Bearer <token>` |
| `MA_RENDER_CONCURRENCY` | `4` | Simultaneous renders. Each is a Chrome page + ffmpeg process |
| `MA_RENDER_CAPTURE` | `canvas` | `canvas` = in-page `toDataURL`; `screenshot` = compositor JPEG. Screenshot measured ~5× slower at 1080p; use only to diagnose a canvas capture bug |
| `MA_VAAPI_DEVICE` | `/dev/dri/renderD128` | VAAPI render node |
| `MA_ALLOW_SOFTWARE` | unset | `1` permits starting with no hardware encoder (no app will use it) |
| `MA_RENDER_NO_SANDBOX` | unset | `1` adds `--no-sandbox` (Chrome also does this automatically as root) |
| `MA_RENDER_CHROME_FLAGS` | unset | Extra Chrome flags, space-separated, appended last |
| `CHROME_PATH` | auto-detected | Chrome/Chromium binary |

Token example:

```bash
MA_RENDER_HOST=0.0.0.0 MA_RENDER_TOKEN="$(openssl rand -hex 24)" \
  node tools/render-service/service.mjs
```

Put it behind `cloudflared` or a Tailnet rather than exposing the port to the
internet. The token is a shared secret, not user auth; anyone with it can run
renders.

---

## HTTP API

```
GET    /v1/health          -> { ok, version }
GET    /v1/capabilities    -> { encoders, preferred, hardware, gpu?, canvas, rejected }
POST   /v1/probe           { html } -> { duration, fps, width, height, sharedHash, shots[] }
POST   /v1/render          { html, offset, length, encoder?, jobId? } -> video/mp4
DELETE /v1/jobs/:id        -> { cancelled: true } | 404
```

Notes:

- `/v1/health` is unauthenticated so a proxy can probe it; everything else
  requires the token when one is set.
- `/v1/render` is synchronous and returns the MP4 bytes. Response headers carry
  diagnostics: `x-ma-encoder`, `x-ma-frames`, `x-ma-plan`.
- Request bodies may be up to 64 MB, so a scene that fell back to a data-URI
  image still fits. Larger documents get `413`.
- The **page is the source of truth** for `fps`, `width`, and `height`: the
  service reads them from `window.MOBILE_AGENT_VIDEO` rather than trusting the
  caller.
- Closing the request aborts the job. ffmpeg is killed and the temp file is
  removed. For explicit cancellation, send `jobId` and `DELETE /v1/jobs/:id`.
- `encoder` must be one of `/v1/capabilities`' `encoders`; anything else is a
  `400`. There is no software fallback.

### Errors are deliberately specific

| Case | Response |
|---|---|
| Scene declares an `audio` schedule | `500` "Audio schedules are not supported by this render node yet" |
| Scene omits `audio` | `500` asks for `audio: false` or an audio schedule |
| Scene contains `<video>` | `500` "Video clips are not supported… no workspace asset transport" |
| Unknown encoder (e.g. `libx264`) | `400` with the available list |
| Page never defines `MOBILE_AGENT_VIDEO` | `400` |

---

## Performance (RTX 5060, 1080p, 45 s segment = 1350 frames)

| Run | Wall time | Throughput |
|---|---|---|
| 720p, one segment | 12.5 s | ~3.6× real time |
| 1080p, one segment | 20.6 s | ~2.2× real time |
| 4 × 1080p in parallel | 30.1 s wall | ~6× real time |
| 1080p, screenshot capture | 100.5 s | ~0.45× — why `canvas` is the default |

The phone records at roughly 1× real time, so a 4-way node turns a 6-minute
1080p render into about one minute. Encode dominates: the PNG/JPEG capture and
canvas raster are secondary.

---

## Pointer: how it works

- `capabilities.mjs` — detect encoders with `ffmpeg -encoders`, then prove each
  one with a real encode; detect GPU vendor/name; hold the canvas mode reported
  by the Chromium probe.
- `chromium.mjs` — find/launch Chrome with GPU raster flags, expose a minimal
  CDP client (Node's global `WebSocket`, no Playwright).
- `runtime.js` — injected page harness. Ports `fnv1a`, `describeContract`, and
  `renderFrame` from `src/modules/preview/video-recorder.ts` so cache identity
  and shot dispatch match the device byte for byte.
- `render.mjs` — load the document, set viewport to the plan size, step
  `t = offset + i/fps`, capture each frame, pipe to ffmpeg.
- `service.mjs` — HTTP routes, concurrency limiter, job registry, cancellation.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `No hardware encoder could be opened` | Driver, missing `/dev/dri`, or a stale ffmpeg build without `*_nvenc` |
| `canvas: cpu` | Chrome fell back to SwiftShader. Check `MA_RENDER_CHROME_FLAGS`, the DRM node, and that Chrome is not launched with `--disable-gpu` |
| `Chrome did not expose a debugging port` | Sandbox/root issue, or a Chrome crash; the error includes the tail of stderr |
| First frame is slow / empty | Scene draws asynchronously after load. Draw inside `render(t)`; the harness awaits images but not arbitrary timers |
| Colours shift after concat | Segments were mixed across profiles. Never reuse footage between encoders; the cache key includes the encoder for this reason |
| Render produces a black video | Scene draws on a canvas the harness cannot find. Set `canvasId` |
