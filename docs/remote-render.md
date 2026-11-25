# Remote video rendering: backend seam

Design sketch for producing render segments on another machine while keeping the
existing on-device segment cache, shot reuse, and concat semantics.

Status: steps 1–4 are implemented (backend seam, profile-scoped cache, bounded
segment pool, and a GPU render node behind a setting — device default, no
behaviour change). Step 5 (parallel sharding beyond the segment pool) is still
design. The node itself lives in `tools/render-service/` and renders silent,
clip-free scenes; see its README for status and limits.

---

## 1. The one invariant

> A backend produces segments. The cache always lives on the device.

`Paths.cache` remains the single source of truth for `render-<key>-seg-*.mp4`.
A remote segment is downloaded into that cache and is then indistinguishable
from a locally recorded one — so `renderPlannedTimeline`'s reuse logic
(`render-segments.ts:588-611`) works unchanged. Nothing in the cache path may
ever branch on "which backend produced this".

The only thing that must not be shared is footage across **profiles** (§3).

---

## 2. Interface

See `src/modules/preview/render-backend.ts`. Shape:

```ts
type RenderBackend = {
  id: string;                    // diagnostics only, never a cache key
  kind: "device" | "remote";
  concurrency: number;           // device: 1, remote: 4–8
  supportsProbe: boolean;
  profileFor(plan): RenderProfile;
  probe(html, { signal }): Promise<VideoRenderPlan>;
  renderSegment(request): Promise<SegmentArtifact>;
  concat(uris, outUri): Promise<void>;
};
```

Deliberately absent: caching, progress aggregation, encoder pinning, pruning,
and error text. Those stay in `render-segments.ts` so the two paths cannot drift.

`createDeviceRenderBackend()` is a thin wrapper over `requestVideoRender` +
`concatSegments`; behaviour is byte-identical to today.

---

## 3. Cache keys get a profile suffix

Concat sample-copies every segment under the **first** segment's SPS/PPS
(`SegmentConcat.kt`). MediaCodec and libx264 do not emit matching parameter sets,
so a device segment and a remote segment can never join.

Therefore:

```
render-<sharedHash>@<profileId>-<offset>-<length>-<keysHash>.mp4
profileId = h264_nvenc-1080x1920-30-yuv420p   (profileIdFor(), render-backend.ts)
            h264_mediacodec-unknown-yuv420p   (legacy scenes: no probe, no dims)
```

The encoder name implies the codec, so the codec is not repeated in the id.

Consequences, stated plainly:

- Switching backend **re-renders the timeline once**. That is correct, not a bug.
- Revisions on the *same* backend still reuse shots — which is the actual win.
- `pruneSceneSegments` is called with `sharedHash@profileId`, so it only drops
  superseded footage *within* a profile. Another profile's footage is kept on
  purpose: toggling back is then instant, and the cost is bounded by
  `MAX_SHOT_SEGMENTS` × segment size inside `Paths.cache`, which the OS may
  reclaim anyway.
- `SegmentSidecar` carries `profile` and `origin`; a sidecar whose profile does
  not match the filename is treated as a cache miss rather than as footage.

**Encoder pinning vs. parallelism.** Segment 1's observed encoder pins the rest,
which a fan-out cannot wait for. Implemented: `runEncoder` is seeded from
`profile.encoder` when `backend.concurrency > 1`; the device stays at
`concurrency: 1` and keeps the observed-encoder behaviour exactly.

---

## 4. GPU: a capability, not a setting

"Use the GPU" is not something the app can assert. The app ships HTML; the render
box chooses how to draw and encode it. So the target must **declare** its
encoders and the app must **refuse** a software-only target — otherwise the user
waits minutes on x264 to save nothing.

### 4.1 Two different costs, only one of which really matters

| Stage | Accelerated by | Cost of a CPU fallback |
|---|---|---|
| Canvas raster (`render(t)`) | Chromium GPU raster (Skia Ganesh/Graphite) | Modest for flat 1080p scenes; 3–10× worse with blur, shadows, blend modes, large image scaling |
| H.264 encode | NVENC / QSV / AMF / VAAPI / VideoToolbox | 5–20× worse and it pins every core for the whole render |

Encode dominates at 1080p30. **CPU raster + hardware encode is fine. GPU raster +
x264 is not.** That ordering is what the capability check enforces.

Note the device path already satisfies this: MediaCodec is fixed-function
hardware, which is why the phone can record 1080p30 in real time at all.

### 4.2 Encoder matrix

| Box | ffmpeg encoder | Flags that matter |
|---|---|---|
| NVIDIA (GTX 10xx+, Quadro, Tesla) | `h264_nvenc` / `hevc_nvenc` | `-preset p5 -tune hq -rc vbr -cq 19` |
| Intel iGPU (QuickSync) | `h264_qsv` / `hevc_qsv` | `-preset veryfast -global_quality 20` |
| AMD (Linux) | `h264_vaapi` | `-vaapi_device /dev/dri/renderD128 -vf format=nv12,hwupload` |
| AMD (Windows) | `h264_amf` | `-quality balanced -rc vbr_peak` |
| Apple Silicon / Mac | `h264_videotoolbox` | `-q:v 55 -realtime 0` |
| **No GPU** | `libx264` | `-preset ultrafast -crf 20` — correct, but this is the case we reject |

Reference invocation:

```bash
ffmpeg -f image2pipe -framerate "$FPS" -i - \
  -c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq 19 \
  -pix_fmt yuv420p -movflags +faststart segment.mp4
```

Quality caveat: NVENC at low bitrate is softer than x264 on flat synthetic
content (large color fields, thin text). Budget ~1.5–2× the bitrate you would
use for x264, or use HEVC where the target supports it. This is a quality knob,
not a correctness issue.

### 4.3 Making Chromium actually use the GPU

Headless Chromium silently falls back to CPU raster, which is exactly the
failure mode to avoid:

```
--headless=new
--use-angle=gl            # or --use-angle=vulkan
--enable-gpu-rasterization
--enable-zero-copy
--ignore-gpu-blocklist
--disable-software-rasterizer   # fail loudly instead of silently going CPU
```

On NVIDIA you generally also need a working DRM device
(`nvidia-drm.modeset=1`) or an Xvfb display. If the canvas probe still reports
`cpu`, pass extra flags through `MA_RENDER_CHROME_FLAGS` (see the render
service README). In a container: `--gpus all` and
`NVIDIA_DRIVER_CAPABILITIES=compute,video,utility`; the VAAPI lane needs
`/dev/dri` bind-mounted and the `video` group.

Verify from the page, not from hope: read the renderer via CDP
(`SystemInfo.getInfo` → `auxAttributes.glRenderer`) and report
`canvas: "gpu" | "cpu"` in `/v1/capabilities`.

### 4.4 Handshake, and why the profile id carries the encoder

1. App calls `GET /v1/capabilities` once per session, caches the result.
2. `requireHardwareEncoding()` (`render-backend.ts`) throws a one-line,
   actionable error when `hardware === false`. No silent x264 fallback.
3. The chosen encoder goes into the profile id
   (`h264-nvenc-1080x1920-30-yuv420p`), so a CPU encode and a GPU encode of the
   same scene never share cache entries — their SPS/PPS would not concat.

Startup self-test worth having: encode 1 s of colour bars with the chosen
encoder and record wall time. It catches "NVENC present but the driver is
broken", which `ffmpeg -encoders` does not.

### 4.5 Consequence for Cloudflare

Cloudflare Containers expose no GPU, and a bare Worker has no ffmpeg at all. So
Cloudflare can host the control plane (queue, auth, R2, signed URLs) but **not**
the render node. A GPU box (local PC, or a rented GPU instance) behind
`cloudflared` is the shape that satisfies "use the GPU".

---

## 5. Exact touch points

### `src/modules/preview/render-segments.ts`

| Line | Today | Change |
|---|---|---|
| 265–281 | `renderSegments(options)` | ✅ done — `backend?: RenderBackend`, defaults to the device backend |
| 287–305 | inline `probeVideoPlan` gate | ✅ done — `backend.supportsProbe ? backend.probe(...) : null` |
| 333–347 | legacy `runOne` → `requestVideoRender` | ✅ done — delegates to `backend.renderSegment` |
| 379–380 | legacy sidecar name | ✅ done — `@profileId` in the name |
| 401 | legacy segment filename | ✅ done — `@profileId` in the name |
| 467–481 | legacy `concatSegments` | ✅ done — `backend.concat(uris, outFile.uri)` |
| 557–570 | planned `runOne` | ✅ done — delegates to `backend.renderSegment` |
| 572–581 | `baseName` / `filesFor` | ✅ done — profile folded into the namespace |
| 583–611 | sequential cache-hit loop | split into *resolve* (sync, cheap) then *schedule* (§6) |
| 613–624 | one render per iteration | enqueue into the bounded pool, keep per-segment error text |
| 630–660 | move + sidecar write | ✅ done — writes `profile`, `origin`, `encoder` |
| 705–711 | `SegmentSidecar` | ✅ done — `profile`, `origin` |
| 789–815 | `pruneSceneSegments` | ✅ done — called with `sharedHash@profileId` |

### Call sites (both surfaces, one switch)

- `src/modules/tools/built-in/render-video.ts` (`renderVideo` tool)
- `src/components/ui/code-preview-dialog.tsx` (Export button)

Both pass a content hash as `sourceFileId` and call
`renderVideoWithResolvedBackend` (`render-backend-resolution.ts`). That helper
reads the setting, resolves the backend, and applies the fallback policy, so the
tool and the Export button cannot diverge. The `renderVideo` tool description
does not name a backend because the setting is per-install and can change between
runs; the result's `warnings` state which one actually ran when it fell back.

### Assets — the real blocker

`video-assets.ts` rewrites refs to `http://127.0.0.1:<port>/files/…`
(`:406`, `:869`). A remote box cannot reach the phone's loopback.

Two options, pick one:

1. **Push** — new `prepareAssetsForRemote(html, repo, jobId)` that uploads each
   asset once per job and rewrites refs to `http://<render-host>/jobs/<id>/…`.
   Keeps clips streaming (range requests) instead of ballooning the document.
2. **Pull** — the bridge already exposes LAN/tailnet URLs and a native HTTP
   server (`src/modules/bridge/reach.ts`, `native-http-server.ts`), so the PC can
   fetch from the phone. Better for 200 MB audio / 1 GB clips; worse for NAT.

Do **not** reuse `MediaPrepMode = "export" | "preview"` (`:763`) for this. The
data-URI fallback is a heap cap, not a transport.

### Audio

Today: page mixes with Web Audio, native muxer writes samples per segment, and
`SegmentConcat.kt:119` handles the 50 ms seam fades. Remote: `OfflineAudioContext`
→ WAV → ffmpeg per segment, with `afade in/out` at the same 50 ms so seams do not
pop. Any change to that number must change both sides in one commit.

---

## 6. Scheduling: resolve → pool → assemble (implemented)

```
1. probe            → plan (duration, fps, size, sharedHash, shots)
2. planShotSegments → segments
3. resolve          → cached[] (uri + sidecar) | pending[]  (cache hits pin runEncoder)
4. seed runEncoder  → profile.encoder when concurrency > 1
5. render pending   → pool of min(concurrency, pending.length)
6. assemble         → move into Paths.cache + sidecar, IN TIMELINE ORDER
7. concat in order  → backend.concat()
```

Three properties worth keeping when this is touched again:

- **Order is correctness, not cosmetics.** Concat sample-copies under the first
  segment's SPS/PPS, so `uris` must be in timeline order regardless of the order
  segments finished.
- **Failures still assemble.** The pool records the first failure, stops
  launching, lets in-flight work land, assembles everything that arrived, and
  *then* throws. Without that, "re-run to resume — finished segments are kept"
  would be false and a failed 10-minute render would start from zero.
- **Progress is monotonic.** It is `Σ weight·(settled ? 1 : fraction)`, clamped
  with `Math.max(reported, …)` because a segment's own fraction can wobble.
  `bases[i]` equals the old `offset/total` (segments are contiguous from 0), so
  the device's bar is unchanged.

`concurrency === 1` keeps the old sequential semantics exactly, including the
encoder observed on segment *n* pinning segment *n+1*. Only backends that
declare their encoder up front take the pool branch.

Abort: the pool stops launching and passes `signal` to `renderSegment`. A remote
backend still needs `DELETE /v1/jobs/:id`, because cancelling the HTTP request
does not kill a running ffmpeg process.

---

## 7. Remote service contract

Implemented by `tools/render-service/` (see its README for setup). Minimal,
transport-agnostic; the app only needs these behaviours.

```
GET  /v1/health                          -> { ok, version }          (no auth)
GET  /v1/capabilities                    -> { encoders, preferred, hardware, gpu?, canvas }
POST /v1/probe
  { html }                               -> { duration, fps, width, height, sharedHash, shots[] }
POST /v1/render
  { html, offset, length, encoder?, jobId? }
                                         -> video/mp4 (bytes)
DELETE /v1/jobs/:id                      -> { cancelled: true } | 404
```

The queue/result endpoints from the original sketch are intentionally absent:
synchronous rendering is fast enough for a ≤45 s segment, and job polling would
add a second failure mode for no gain. `jobId` exists only so a cancellation can
reach a running ffmpeg process. Closing the request aborts the job too.

The app side is split in three:

- `remote-render-backend.ts` — HTTP + writing bytes into `Paths.cache`. Declares
  the encoder from `/v1/capabilities` and calls `requireHardwareEncoding()`.
- `remote-render-settings.ts` — pure normalisation of the setting (URL,
  concurrency); `enabled` requires a valid URL.
- `render-backend-resolution.ts` — reads the setting, resolves the backend, and
  owns the fallback policy: unusable node → device with a warning; a scene the
  node explicitly cannot handle (audio, clips) → one retry on the device.

Server side is small: headless Chromium with `--autoplay-policy=no-user-gesture-required`,
a page that calls `render(t)` for `t = offset + i/fps`, `canvas.toDataURL`/CDP
frame capture, `OfflineAudioContext` for the mix (not yet implemented),
`ffmpeg -f image2pipe` + the vendor encoder. Because `render(t)` is a pure
function of `t`, frames can be stepped as fast as the encoder accepts — faster
than real time, and shardable across processes.

The response **must** report the actual encoded duration, same as the device
path (`render-video.ts:52` already tells the model to quote the result, not the
request).

---

## 8. Risks to decide before coding

- **Determinism.** Fonts, WebGL availability, and `devicePixelRatio` differ
  between the WebView and headless Chromium. Pin fonts; keep device as the
  verification path when a remote render looks wrong.
- **Privacy.** Scene HTML, images, audio, and any clip frames leave the device.
  Needs an explicit setting, not a default.
- **Cold start / upload.** First remote render pays container boot + asset
  transfer; a 1 GB clip over WAN makes the "faster" path slower. Pull-from-phone
  over LAN/tailnet avoids this.
- **Codec drift.** `getVideoFrame` and the in-app player must accept both
  producers' output; `encoder` in the result already differs today, so this is
  mostly a diagnostics concern.
- **Cloudflare.** A bare Worker cannot render (§ earlier): no ffmpeg, no GPU,
  128 MB, ~30 s CPU. Use it as the control plane only, with Containers or a PC
  behind `cloudflared` as the render node.

---

## 9. Suggested order

1. ✅ Add `backend` to `renderSegments`, default device. Zero behaviour change.
   Covered by `render-segments.test.ts` ("backend seam").
2. ✅ Add `@profileId` to cache names + sidecars + pruning. Still device-only;
   covered by "profile isolation" tests.
3. ✅ Split the planned loop into resolve/pool/concat; device pool size is 1.
   Covered by "concurrency" tests (peak in-flight, timeline order, failure
   keeps footage, monotonic progress).
4. ✅ Implement the remote backend behind a setting, starting with probe + segment
   on the LAN. Device fallback on resolve failure, and one device retry when the
   node says the scene needs audio/clips. Covered by
   `render-backend-resolution.test.ts`.
5. Only then consider parallel sharding on the remote side.
