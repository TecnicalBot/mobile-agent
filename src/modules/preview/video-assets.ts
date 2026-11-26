import type { WorkspaceRepository } from "@/core/db/database";
import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import {
  assertAudioFileUsable,
  buildAudioDataUri,
  extractWorkspaceAudioIds,
  MAX_SERVED_AUDIO_FILE_BYTES,
  readContractDuration,
  readContractSize,
  replaceWorkspaceAudioRef,
} from "@/modules/preview/video-audio";
import type { File } from "expo-file-system";

/**
 * Image/clip helpers for video scenes with user visuals.
 *
 * A scene draws user-provided workspace files with plain DOM elements —
 * `<img src="workspace://<id>">` painted via `drawImage`, or a muted
 * `<video src="workspace://<id>">` driven by scene JS — and the `renderVideo`
 * tool rewrites each reference into something the hidden render WebView can
 * load, because that WebView cannot read the workspace itself. Clips and
 * audio tracks stream over the loopback asset server (no heap cost, no
 * document bloat); images, and every kind on builds without the server, fall
 * back to data URIs (which also keep the canvas readback clean, as export
 * frame capture requires).
 *
 * Extraction is scoped to the element (`<img>` vs `<video>`/`<source>`) so
 * asset kinds are never confused with each other or with `file:` audio
 * tracks. Like video-audio.ts this module is pure apart from the workspace
 * service, so it can be unit-tested in Node with a stubbed repository.
 */

export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
/**
 * Served-image budget. Serving costs nothing (the file streams from disk in
 * 64 KB chunks), so this number is not a document or heap budget — it bounds
 * what we hand the renderer's image decoder. Unlike clips, which stream
 * ranges and are never materialized, an image is decoded eagerly into an RGBA
 * bitmap whose cost grows with pixel area, not file size, which is why this
 * stays far below the clip budget. Kept conservative on purpose: a decode that
 * fails inside a live renderer reports as `naturalWidth === 0`, and a scene
 * following the documented `complete && naturalWidth` guard would then skip
 * the draw and render that visual blank rather than fail.
 */
export const MAX_SERVED_IMAGE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_FILE_BYTES = 15 * 1024 * 1024;
/**
 * Served clips bypass the heap entirely (loopback HTTP + range requests),
 * so the only ceiling is decoder sanity, not memory. Above this, clips
 * transcode down; the 15 MB figure stays as the data-URI fallback cap
 * (heap protection on builds without the server).
 */
/**
 * Direct-serving cap for scene clips: at or under this, clips stream from the
 * loopback server untouched (zero heap cost — the <video> element reads via
 * range requests). Beyond it — or MOV — the native transcoder normalizes to
 * cache. The number is disk policy, not a memory wall; serving more is
 * pointless once a 1 GB source is on device, and transcode handles "absurd".
 */
export const MAX_DIRECT_SERVE_BYTES = 1024 * 1024 * 1024;
/**
 * Transcode target: comfortably under the inline cap so the base64
 * inflation (~33%) still leaves headroom in the render document.
 */
export const TRANSCODE_TARGET_BYTES = 12 * 1024 * 1024;
export const TRANSCODE_MAX_DIMENSION = 1280;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

/** Container the WebView cannot reliably play: always converted to MP4. */
const TRANSCODE_ONLY_VIDEO_MIME_TYPES = new Set(["video/quicktime"]);

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

const IMG_SRC_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*["']workspace:\/\/([A-Za-z0-9][A-Za-z0-9_-]*)/gi;
const VIDEO_SRC_PATTERN =
  /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']workspace:\/\/([A-Za-z0-9][A-Za-z0-9_-]*)/gi;
const VIDEO_TAG_PATTERN = /<(video|source)\b[^>]*>/gi;

function extractScopedIds(html: string, pattern: RegExp): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      ids.push(match[1]);
    }
  }
  return ids;
}

/** Ids referenced by `<img src="workspace://<id>">`. */
export function extractWorkspaceImageIds(html: string): string[] {
  return extractScopedIds(html, IMG_SRC_PATTERN);
}

/** Ids referenced by `<video>`/`<source src="workspace://<id>">`. */
export function extractWorkspaceVideoIds(html: string): string[] {
  return extractScopedIds(html, VIDEO_SRC_PATTERN);
}

/**
 * True when any workspace reference (image, clip, or audio-track) remains.
 * The export/preview WebViews cannot resolve `workspace://` themselves, so
 * a document that still has refs after inlining would record missing media.
 */
export function hasWorkspaceRefs(html: string): boolean {
  return (
    extractWorkspaceImageIds(html).length > 0 ||
    extractWorkspaceVideoIds(html).length > 0 ||
    extractWorkspaceAudioIds(html).length > 0
  );
}

export function resolveImageMimeType(
  mimeType: string | null | undefined,
  displayName: string,
): string | null {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  if (normalized && SUPPORTED_IMAGE_MIME_TYPES.has(normalized)) {
    return normalized;
  }
  const extension = displayName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_BY_EXTENSION[extension] ?? null;
}

export function resolveVideoMimeType(
  mimeType: string | null | undefined,
  displayName: string,
): string | null {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  if (
    normalized &&
    (SUPPORTED_VIDEO_MIME_TYPES.has(normalized) ||
      TRANSCODE_ONLY_VIDEO_MIME_TYPES.has(normalized))
  ) {
    return normalized;
  }
  const extension = displayName.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_MIME_BY_EXTENSION[extension] ?? null;
}

/** True for containers the WebView cannot play directly (always converted). */
export function isTranscodeOnlyVideoMimeType(resolved: string): boolean {
  return TRANSCODE_ONLY_VIDEO_MIME_TYPES.has(resolved);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Validates format and (when the size is known) budget. `sizeBytes` is null on
 * the served lane when the file stat was unavailable — format is still
 * enforced, and the caller has already avoided reading the file at all.
 */
export function assertImageFileUsable(
  displayName: string,
  mimeType: string | null | undefined,
  sizeBytes: number | null,
  maxBytes: number = MAX_IMAGE_FILE_BYTES,
): string {
  const resolved = resolveImageMimeType(mimeType, displayName);
  if (!resolved) {
    throw new Error(
      `File "${displayName}" is not a supported image. Use JPEG, PNG, WebP, or GIF images.`,
    );
  }
  if (sizeBytes == null) {
    return resolved;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`File "${displayName}" appears to be empty.`);
  }
  if (sizeBytes > maxBytes) {
    throw new Error(
      `File "${displayName}" is too large (${formatBytes(sizeBytes)}). Keep scene images under ${formatBytes(maxBytes)}.`,
    );
  }
  return resolved;
}

/**
 * Validates format and (when the size is known) budget. `sizeBytes` is null
 * when the file stat was unavailable — format is still enforced, and the
 * caller falls back to checking the bytes it had to read anyway.
 */
export function assertVideoFileUsable(
  displayName: string,
  mimeType: string | null | undefined,
  sizeBytes: number | null,
): string {
  const resolved = resolveVideoMimeType(mimeType, displayName);
  if (!resolved) {
    throw new Error(
      `File "${displayName}" is not a supported video clip. Use MP4, WebM, or MOV clips.`,
    );
  }
  if (isTranscodeOnlyVideoMimeType(resolved)) {
    // MOV never inlines directly (unreliable WebView playback) — it must go
    // through prepareClipBytes. Reaching here means the caller bypassed it.
    throw new Error(
      `File "${displayName}" needs conversion before use as a scene clip.`,
    );
  }
  if (sizeBytes == null) {
    return resolved;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`File "${displayName}" appears to be empty.`);
  }
  if (sizeBytes > MAX_VIDEO_FILE_BYTES) {
    throw new Error(
      `File "${displayName}" is too large (${formatBytes(sizeBytes)}). Keep scene clips under ${formatBytes(MAX_VIDEO_FILE_BYTES)}.`,
    );
  }
  return resolved;
}

async function inlineAssetUris(
  html: string,
  repository: WorkspaceRepository,
  ids: string[],
  kind: "image" | "clip" | "audio",
  assertUsable: (
    displayName: string,
    mimeType: string | null | undefined,
    sizeBytes: number | null,
  ) => string,
  warnings?: string[],
): Promise<{ html: string; files: string[] }> {
  const files: string[] = [];
  let next = html;
  for (const id of ids) {
    const record = await repository.getById(id);
    if (!record) {
      throw new Error(
        `No workspace ${kind} file found with id ${id}. Save it to the workspace first, or remove its reference from the scene.`,
      );
    }
    const file = resolveWorkspaceFile(record.relativePath);
    if (!file.exists) {
      throw new Error(
        `File "${record.displayName}" is no longer available locally.`,
      );
    }
    // Stat before reading: a 1 GB source must never enter the JS heap
    // just to be rejected. Over-cap clips get a transcode attempt, and MOV
    // always converts (unreliable WebView playback); other kinds fail fast
    // on the stat alone.
    const statSize = typeof file.size === "number" ? file.size : null;
    const clipMime =
      kind === "clip"
        ? resolveVideoMimeType(record.mimeType, record.displayName)
        : null;
    const needsTranscode =
      kind === "clip" &&
      clipMime !== null &&
      (isTranscodeOnlyVideoMimeType(clipMime) ||
        (statSize != null && statSize > MAX_VIDEO_FILE_BYTES));
    if (needsTranscode) {
      const prepared = await prepareClipBytes(
        record.id,
        record.displayName,
        record.mimeType,
        file,
        statSize ?? 0,
        true,
      );
      if (!prepared.bytes) {
        throw new Error(
          `File "${record.displayName}" is too large. Keep scene clips under ${formatClipBytes(MAX_VIDEO_FILE_BYTES)}.`,
        );
      }
      files.push(record.displayName);
      next = next
        .split(`workspace://${id}`)
        .join(buildAudioDataUri(prepared.mimeType, prepared.bytes));
      if (prepared.warning && warnings) warnings.push(prepared.warning);
      continue;
    }
    // Stat before reading: the data-URI lane must reject an over-cap file on
    // its stat, never on bytes already loaded — `FileSystemFile.bytes()`
    // materializes the whole file in one native array (and again in JS), so a
    // ~120 MB soundtrack OOMs the ~256 MB Android heap inside the read itself
    // before the post-read size check could run. Unknown stat keeps the
    // post-read check below as the budget gate.
    if (statSize != null) {
      assertUsable(record.displayName, record.mimeType, statSize);
    } else if (kind !== "clip") {
      assertUsable(record.displayName, record.mimeType, null);
    }
    const bytes = await file.bytes();
    const mimeType = assertUsable(
      record.displayName,
      record.mimeType,
      bytes.length,
    );
    files.push(record.displayName);
    const uri = buildAudioDataUri(mimeType, bytes);
    next =
      kind === "audio"
        ? replaceWorkspaceAudioRef(next, id, uri)
        : next.split(`workspace://${id}`).join(uri);
  }
  return { html: next, files };
}

const WORKSPACE_IMAGE_SRC_PATTERN = /<img\b[^>]*>/gi;
const IMG_SRC_VALUE_PATTERN = /\bsrc\s*=\s*(["'])([^"']*)\1/i;
const WORKSPACE_SRC_ID_PATTERN = /^workspace:\/\/([A-Za-z0-9][A-Za-z0-9_-]*)/;

/**
 * Adds `crossorigin="anonymous"` to a tag that points at a served asset.
 *
 * This is not cosmetic: the export captures frames with `canvas.toDataURL`,
 * and drawing an asset that was loaded cross-origin *without* CORS approval
 * taints the canvas, which makes that read throw a `SecurityError` (MDN, "Use
 * cross-origin images in a canvas"). The loopback server answers every
 * `/files` and `/cache` response with `Access-Control-Allow-Origin: *`, which
 * approves an anonymous (non-credentialed) CORS fetch — `anonymous` is exactly
 * the mode that omits credentials, so `*` is a valid response — and the canvas
 * stays readable. This matters for the `file://` documents (preview and its
 * in-page export), which are opaque origins: Chromium's WebView CORS guidance
 * states opaque origins require `*` or `null` in the response header, which is
 * what we send. The same-origin render host is unaffected either way.
 */
function withCrossOrigin(tag: string): string {
  if (/\bcrossorigin\b/i.test(tag)) return tag;
  return tag.replace(/^<(img|video)\b/i, '<$1 crossorigin="anonymous"');
}

function workspaceIdFromSrc(src: string): string | null {
  const match = WORKSPACE_SRC_ID_PATTERN.exec(src.trim());
  return match ? match[1] : null;
}

/**
 * Tags every `<img>` that points at a workspace file, before either inlining
 * lane runs (each replaces only the src value, so the attribute survives).
 * The export loop awaits these images with `awaitSceneImage`: an image that
 * fails to decode otherwise renders blank through the documented
 * `complete && naturalWidth` draw guard, whereas videos were always awaited
 * with loud failures for the same reason.
 */
function markWorkspaceImageTags(html: string, ids: string[]): string {
  if (ids.length === 0) return html;
  const wanted = new Set(ids);
  return html.replace(WORKSPACE_IMAGE_SRC_PATTERN, (tag) => {
    const match = IMG_SRC_VALUE_PATTERN.exec(tag);
    if (!match) return tag;
    const id = workspaceIdFromSrc(match[2]);
    if (!id || !wanted.has(id)) return tag;
    let next = tag;
    if (!/\bdata-mobile-agent-asset\b/i.test(next)) {
      next = next.replace(/^<img\b/i, '<img data-mobile-agent-asset="image"');
    }
    // The probe reads this id to hand the exporter the original workspace
    // file, so a declared image layer can point Alight Motion at a gallery
    // copy instead of a path the editor cannot read.
    if (!/\bdata-mobile-agent-file-id\b/i.test(next)) {
      next = next.replace(/^<img\b/i, `<img data-mobile-agent-file-id="${id}"`);
    }
    return next;
  });
}

/**
 * Stamps each workspace-backed `<video>`/`<source>` with its workspace file id
 * before the src is rewritten. The editor export probe resolves a declared
 * clip's element back to this id, so the Alight project can use the original
 * clip rather than the flattened shot render.
 */
function markWorkspaceVideoTags(html: string, ids: string[]): string {
  if (ids.length === 0) return html;
  const wanted = new Set(ids);
  return html.replace(VIDEO_TAG_PATTERN, (tag) => {
    if (/\bdata-mobile-agent-file-id\b/i.test(tag)) return tag;
    const src =
      /\bsrc\s*=\s*["']workspace:\/\/([A-Za-z0-9][A-Za-z0-9_-]*)/i.exec(tag);
    if (!src || !wanted.has(src[1])) return tag;
    return tag.replace(
      /^<(video|source)\b/i,
      `<$1 data-mobile-agent-file-id="${src[1]}"`,
    );
  });
}

/**
 * Rewrites served `<img>` sources and marks them CORS-approved in one pass, so
 * the canvas stays readable during export. Only tags we actually rewrote are
 * touched — data-URI and external images are left exactly as authored.
 */
function serveImageTags(html: string, servedById: Map<string, string>): string {
  return html.replace(WORKSPACE_IMAGE_SRC_PATTERN, (tag) => {
    const match = IMG_SRC_VALUE_PATTERN.exec(tag);
    if (!match) return tag;
    const id = workspaceIdFromSrc(match[2]);
    if (!id) return tag;
    const served = servedById.get(id);
    if (!served) return tag;
    return withCrossOrigin(
      tag.replace(match[0], `src=${match[1]}${served}${match[1]}`),
    );
  });
}

/**
 * Marks every `<video>` tag that points at a served URL, covering both
 * `<video src="…">` and `<video><source src="…"></video>` (the CORS setting
 * attribute lives on the media element, not on `<source>`).
 */
function serveVideoCrossOrigin(html: string, servedUrls: string[]): string {
  if (servedUrls.length === 0) return html;
  const touches = (chunk: string) =>
    servedUrls.some((url) => chunk.includes(url));
  const blocks = html.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (block) =>
    touches(block) ? withCrossOrigin(block) : block,
  );
  return blocks.replace(/<video\b[^>]*>/gi, (tag) =>
    touches(tag) ? withCrossOrigin(tag) : tag,
  );
}

/**
 * Rewrites `<img>`-referenced workspace files for the scene WebViews.
 *
 * Served lane (loopback asset server present): the reference becomes an
 * `http://127.0.0.1:<port>/files/…` URL and the tag gains
 * `crossorigin="anonymous"`, so a large image streams from disk instead of
 * bloating the document and still leaves the export canvas readable.
 * Fallback lane (server unavailable): today's data URI (15 MB budget), which
 * needs no CORS attribute because data URLs never taint a canvas.
 */
export async function inlineImageAssets(
  html: string,
  repository: WorkspaceRepository,
): Promise<{ html: string; imageFiles: string[] }> {
  const ids = extractWorkspaceImageIds(html);
  if (ids.length === 0) {
    return { html, imageFiles: [] };
  }
  const marked = markWorkspaceImageTags(html, ids);

  const { ensureAssetServer, workspaceFileUrl } =
    await import("@/modules/preview/asset-server");
  const baseUrl = await ensureAssetServer().catch(() => null);
  if (!baseUrl) {
    return inlineAssetUris(
      marked,
      repository,
      ids,
      "image",
      assertImageFileUsable,
    ).then(({ html: inlined, files }) => ({
      html: inlined,
      imageFiles: files,
    }));
  }

  const servedById = new Map<string, string>();
  const imageFiles: string[] = [];
  for (const id of ids) {
    const record = await repository.getById(id);
    if (!record) {
      throw new Error(
        `No workspace image file found with id ${id}. Save it to the workspace first, or remove its reference from the scene.`,
      );
    }
    const file = resolveWorkspaceFile(record.relativePath);
    if (!file.exists) {
      throw new Error(
        `File "${record.displayName}" is no longer available locally.`,
      );
    }
    // Stat-only gate: a 100 MB image must never be read into the JS heap.
    const statSize = typeof file.size === "number" ? file.size : null;
    assertImageFileUsable(
      record.displayName,
      record.mimeType,
      statSize,
      MAX_SERVED_IMAGE_FILE_BYTES,
    );
    imageFiles.push(record.displayName);
    servedById.set(id, workspaceFileUrl(baseUrl, record.relativePath));
  }

  return { html: serveImageTags(marked, servedById), imageFiles };
}

/**
 * Over-cap clip handling: transcode down via the native module instead of
 * failing. Returns scene-ready bytes plus a user-facing warning. Throws the
 * original oversize error when transcoding is unavailable or cannot fit.
 */
async function prepareClipBytes(
  id: string,
  displayName: string,
  mimeType: string | null | undefined,
  file: File,
  statSize: number,
  readBytes: boolean,
): Promise<{
  bytes: Uint8Array | null;
  mimeType: string;
  warning?: string;
  cacheName: string;
}> {
  const resolved = resolveVideoMimeType(mimeType, displayName);
  if (!resolved) {
    throw new Error(
      `File "${displayName}" is not a supported video clip. Use MP4, WebM, or MOV clips.`,
    );
  }
  const needsConversion = isTranscodeOnlyVideoMimeType(resolved);
  const tooLarge = new Error(
    `File "${displayName}" is too large (${statSize > 0 ? formatClipBytes(statSize) : "over the budget"}). Keep scene clips under ${formatClipBytes(MAX_VIDEO_FILE_BYTES)}.`,
  );
  // Lazy: expo-file-system and the native module pull react-native, which
  // cannot even parse in unit tests. Only the over-cap path pays for it.
  let transcodeClip:
    | ((
        inputPath: string,
        outputPath: string,
        maxBytes: number,
        maxDimension: number,
      ) => Promise<{
        path: string;
        width: number;
        height: number;
        sizeBytes: number;
      }>)
    | null = null;
  let cacheFileFor:
    | ((name: string) => {
        uri: string;
        exists: boolean;
        size: number | null;
        bytes: () => Promise<Uint8Array>;
        delete: () => void;
      })
    | null = null;
  try {
    const [fs, native] = await Promise.all([
      import("expo-file-system"),
      import("html-video-export"),
    ]);
    const module = native.getHtmlVideoExportModule();
    if (module && typeof module.transcodeClip === "function") {
      transcodeClip = module.transcodeClip.bind(module);
      cacheFileFor = (name: string) =>
        new fs.File(fs.Paths.cache, name) as unknown as {
          uri: string;
          exists: boolean;
          size: number | null;
          bytes: () => Promise<Uint8Array>;
          delete: () => void;
        };
    }
  } catch {
    transcodeClip = null;
  }
  if (!transcodeClip || !cacheFileFor) {
    throw tooLarge;
  }
  const inputUri = file.uri;
  const inputPath = inputUri.startsWith("file://")
    ? inputUri.slice("file://".length)
    : inputUri;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cacheName = `clip-${safeId}-${statSize}.mp4`;
  const outFile = cacheFileFor(cacheName);
  let transcodedSize: number | null = null;
  try {
    if (!outFile.exists) {
      const outPath = outFile.uri.startsWith("file://")
        ? outFile.uri.slice("file://".length)
        : outFile.uri;
      const done = await transcodeClip(
        inputPath,
        outPath,
        TRANSCODE_TARGET_BYTES,
        TRANSCODE_MAX_DIMENSION,
      );
      if (done && typeof done.sizeBytes === "number")
        transcodedSize = done.sizeBytes;
    }
    const bytes = readBytes ? await outFile.bytes() : null;
    if (
      readBytes &&
      (!bytes || bytes.length === 0 || bytes.length > MAX_VIDEO_FILE_BYTES)
    ) {
      try {
        outFile.delete();
      } catch {
        /* best effort */
      }
      throw tooLarge;
    }
    const outSize = bytes
      ? bytes.length
      : (transcodedSize ?? outFile.size ?? statSize);
    const sizeText = outSize > 0 ? formatClipBytes(outSize) : "unknown size";
    return {
      bytes,
      mimeType: "video/mp4",
      cacheName,
      warning: needsConversion
        ? `"${displayName}" is MOV, which scenes cannot play directly — converted to MP4 (${sizeText}). Detail may be softer; attach an MP4 to skip this.`
        : `"${displayName}" was ${statSize > 0 ? formatClipBytes(statSize) : "over the budget"} — over the ${formatClipBytes(MAX_VIDEO_FILE_BYTES)} scene-clip budget, so it was compressed to ${sizeText}. Detail may be softer; attach a smaller file or trim it to skip this.`,
    };
  } catch (error) {
    if (error === tooLarge) throw error;
    throw new Error(
      `File "${displayName}" is too large (${statSize > 0 ? formatClipBytes(statSize) : "over the budget"}) and could not be compressed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function formatClipBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

/**
 * Seek-proxy ceiling: the contract canvas long edge, clamped to the
 * recorder's supported range (160–1920), default 1280. A proxy larger than
 * the export canvas is pure waste — the renderer never shows more pixels
 * than the canvas holds.
 */
function seekProxyMaxDimension(html: string): number {
  const size = readContractSize(html);
  const longEdge = size ? Math.max(size.width, size.height) : 1280;
  return Math.round(Math.min(1920, Math.max(160, longEdge)));
}

/**
 * Builds (or reuses) a RIFF/WAVE decode of a served soundtrack so the
 * export can Range-fetch just the samples each segment plays. Without it
 * every segment re-fetches and `decodeAudioData`-decodes the WHOLE file
 * before frame 1 — O(segments) decodes of the same bytes, the dominant
 * fixed cost of long soundtracks. Returns the cache URL to serve in place
 * of the original, or null to serve the original unchanged (native op
 * missing on older builds, decode failure, unknown size or contract
 * duration): every case is today's correct behavior, never a render
 * failure. The WAV container keeps preview players working — they decode
 * it with `decodeAudioData` exactly like the original file.
 *
 * Written to a `.part` name and renamed only after the native decode
 * reports success, so a kill mid-decode can never leave a truncated WAV
 * under a trusted name for a later run to serve.
 */
async function audioPcmUrl(
  baseUrl: string,
  record: { id: string; displayName: string },
  file: File,
  statSize: number | null,
  maxSeconds: number,
): Promise<string | null> {
  if (statSize == null || statSize <= 0) return null;
  if (!(maxSeconds > 0)) return null;
  const inputUri = (file as { uri?: unknown }).uri;
  if (typeof inputUri !== "string" || inputUri.length === 0) return null;
  type DecodeWavFn = (
    inputPath: string,
    outputPath: string,
    maxSeconds: number,
  ) => Promise<{ bytes?: number }>;
  let decodeAudioWav: DecodeWavFn | null = null;
  let cacheFileUrl: ((urlBase: string, name: string) => string) | null = null;
  let cacheFileFor:
    | ((name: string) => {
        uri: string;
        exists: boolean;
        delete: () => void;
        move: (
          dest: unknown,
          options?: { overwrite?: boolean },
        ) => Promise<void>;
      })
    | null = null;
  try {
    const [fs, native, server] = await Promise.all([
      import("expo-file-system"),
      import("html-video-export"),
      import("@/modules/preview/asset-server"),
    ]);
    const module = native.getHtmlVideoExportModule();
    if (module && typeof module.decodeAudioWav === "function") {
      decodeAudioWav = module.decodeAudioWav.bind(module);
      cacheFileUrl = server.cacheFileUrl;
      cacheFileFor = (name: string) =>
        new fs.File(fs.Paths.cache, name) as unknown as {
          uri: string;
          exists: boolean;
          delete: () => void;
          move: (
            dest: unknown,
            options?: { overwrite?: boolean },
          ) => Promise<void>;
        };
    }
  } catch {
    return null;
  }
  if (!decodeAudioWav || !cacheFileFor || !cacheFileUrl) return null;
  const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  // The bound rides the name: a longer contract re-decodes, never reuses a
  // shorter file whose tail is missing.
  const cacheName = `audio-pcm-${safeId}-${statSize}-${Math.round(maxSeconds)}.wav`;
  const partName = `${cacheName}.part`;
  const outFile = cacheFileFor(cacheName);
  try {
    if (!outFile.exists) {
      const partFile = cacheFileFor(partName);
      if (partFile.exists) {
        // Stale partial from an interrupted run; overwrite below anyway.
        try {
          partFile.delete();
        } catch {
          /* best effort */
        }
      }
      const strip = (uri: string) =>
        uri.startsWith("file://") ? uri.slice("file://".length) : uri;
      const done = await decodeAudioWav(
        strip(inputUri),
        strip(partFile.uri),
        maxSeconds,
      );
      if (!done || typeof done.bytes !== "number" || done.bytes <= 0) {
        try {
          partFile.delete();
        } catch {
          /* best effort */
        }
        return null;
      }
      await partFile.move(outFile, { overwrite: true });
    }
    return cacheFileUrl(baseUrl, cacheName);
  } catch {
    // Optimization only: any failure serves the original soundtrack.
    try {
      const partFile = cacheFileFor(partName);
      if (partFile.exists) partFile.delete();
    } catch {
      /* best effort */
    }
    return null;
  }
}

/**
 * Builds (or reuses) an all-keyframe seek proxy for a served clip, so the
 * export's frame-accurate seeks decode ONE source frame instead of a whole
 * GOP: Chromium resets the demuxer and decoder to the previous keyframe on
 * every `currentTime` assignment, which makes a clip-heavy render decode
 * dozens of source frames per exported frame. Returns the cache URL to
 * serve in place of the original, or null to serve the original unchanged —
 * the native op may be missing (builds predating it), the transcode may
 * fail, or the device encoder may refuse all-intra (native verifies and
 * deletes); every case is today's correct behavior without the speedup,
 * never a render failure.
 *
 * The file is written to a `.part` name and renamed only after verification,
 * so a process kill mid-transcode can never leave a truncated proxy under a
 * trusted name for a later run to serve.
 */
async function seekProxyUrl(
  baseUrl: string,
  record: { id: string; displayName: string },
  file: File,
  statSize: number | null,
  maxDimension: number,
): Promise<string | null> {
  if (statSize == null || statSize <= 0) return null;
  const inputUri = (file as { uri?: unknown }).uri;
  if (typeof inputUri !== "string" || inputUri.length === 0) return null;
  type SeekProxyFn = (
    inputPath: string,
    outputPath: string,
    maxDimension: number,
  ) => Promise<{ allIntra?: boolean }>;
  let makeSeekProxy: SeekProxyFn | null = null;
  let cacheFileUrl: ((urlBase: string, name: string) => string) | null = null;
  let cacheFileFor:
    | ((name: string) => {
        uri: string;
        exists: boolean;
        delete: () => void;
        move: (
          dest: unknown,
          options?: { overwrite?: boolean },
        ) => Promise<void>;
      })
    | null = null;
  try {
    const [fs, native, server] = await Promise.all([
      import("expo-file-system"),
      import("html-video-export"),
      import("@/modules/preview/asset-server"),
    ]);
    const module = native.getHtmlVideoExportModule();
    if (module && typeof module.makeSeekProxy === "function") {
      makeSeekProxy = module.makeSeekProxy.bind(module);
      cacheFileUrl = server.cacheFileUrl;
      cacheFileFor = (name: string) =>
        new fs.File(fs.Paths.cache, name) as unknown as {
          uri: string;
          exists: boolean;
          delete: () => void;
          move: (
            dest: unknown,
            options?: { overwrite?: boolean },
          ) => Promise<void>;
        };
    }
  } catch {
    return null;
  }
  if (!makeSeekProxy || !cacheFileFor || !cacheFileUrl) return null;
  const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cacheName = `proxy-${safeId}-${statSize}-${maxDimension}.mp4`;
  const partName = `${cacheName}.part`;
  const outFile = cacheFileFor(cacheName);
  try {
    if (!outFile.exists) {
      const partFile = cacheFileFor(partName);
      if (partFile.exists) {
        // Stale partial from an interrupted run; overwrite below anyway.
        try {
          partFile.delete();
        } catch {
          /* best effort */
        }
      }
      const strip = (uri: string) =>
        uri.startsWith("file://") ? uri.slice("file://".length) : uri;
      const done = await makeSeekProxy(
        strip(inputUri),
        strip(partFile.uri),
        maxDimension,
      );
      if (!done || done.allIntra !== true) {
        // Not all-intra (or op failed): no proxy, no half-written leftovers.
        try {
          partFile.delete();
        } catch {
          /* best effort */
        }
        return null;
      }
      await partFile.move(outFile, { overwrite: true });
    }
    return cacheFileUrl(baseUrl, cacheName);
  } catch {
    // Optimization only: any failure serves the original clip.
    try {
      const partFile = cacheFileFor(`${cacheName}.part`);
      if (partFile.exists) partFile.delete();
    } catch {
      /* best effort */
    }
    return null;
  }
}

/**
 * How thorough the media pass may be.
 *
 * - `export`: may build native caches (all-keyframe seek proxies, WAV
 *   soundtracks). Those take minutes of transcoding on a long clip, so the
 *   export path pays them once and every later render reuses the files.
 * - `preview`: never transcodes. The preview must open immediately, and a
 *   proxy only changes seek cost, never what a frame looks like.
 */
export type MediaPrepMode = "preview" | "export";

/**
 * Inlines `<video>`/`<source>`-referenced workspace clips.
 * Clips play muted and scene-driven; the recorder captures its own audio
 * graph, never page audio.
 *
 * Preferred path serves clips as same-origin loopback URLs (zero heap
 * inflation, byte-range seeking, clean canvas readback). Over-cap clips
 * and MOV are transcoded to cache first, with a warning per file. When the
 * asset server is unavailable the legacy data-URI path runs instead, and
 * only unfixable clips throw.
 */
export function inlineVideoAssets(
  html: string,
  repository: WorkspaceRepository,
  mode: MediaPrepMode = "export",
): Promise<{ html: string; videoFiles: string[]; warnings: string[] }> {
  const ids = extractWorkspaceVideoIds(html);
  if (ids.length === 0) {
    return Promise.resolve({ html, videoFiles: [], warnings: [] });
  }
  const warnings: string[] = [];
  return inlineClipRefs(html, repository, ids, warnings, mode).then(
    ({ html: out, files }) => ({ html: out, videoFiles: files, warnings }),
  );
}

async function inlineClipRefs(
  html: string,
  repository: WorkspaceRepository,
  ids: string[],
  warnings: string[],
  mode: MediaPrepMode,
): Promise<{ html: string; files: string[] }> {
  const marked = markWorkspaceVideoTags(html, ids);
  const { ensureAssetServer, workspaceFileUrl, cacheFileUrl } =
    await import("@/modules/preview/asset-server");
  const baseUrl = await ensureAssetServer().catch(() => null);
  if (!baseUrl) {
    return inlineAssetUris(
      marked,
      repository,
      ids,
      "clip",
      assertVideoFileUsable,
      warnings,
    );
  }
  const files: string[] = [];
  const servedUrls: string[] = [];
  let next = marked;
  // One canvas ceiling for every clip of this document — a proxy larger
  // than the export canvas never shows its extra pixels.
  const proxyMaxDim = seekProxyMaxDimension(html);
  for (const id of ids) {
    const record = await repository.getById(id);
    if (!record) {
      throw new Error(
        `No workspace clip file found with id ${id}. Save it to the workspace first, or remove its reference from the scene.`,
      );
    }
    const resolved = resolveVideoMimeType(record.mimeType, record.displayName);
    if (!resolved) {
      throw new Error(
        `File "${record.displayName}" is not a supported video clip. Use MP4, WebM, or MOV clips.`,
      );
    }
    const file = resolveWorkspaceFile(record.relativePath);
    if (!file.exists) {
      throw new Error(
        `File "${record.displayName}" is no longer available locally.`,
      );
    }
    files.push(record.displayName);
    const statSize = typeof file.size === "number" ? file.size : null;
    // Served clips bypass the heap: only absurd files (>1 GB) or MOV
    // transcode. Anything smaller serves at full quality, no warning.
    const convert =
      isTranscodeOnlyVideoMimeType(resolved) ||
      (statSize != null && statSize > MAX_DIRECT_SERVE_BYTES);
    if (!convert) {
      // Serve an all-keyframe proxy when this build can make one: every
      // export seek then decodes one frame instead of a whole GOP (the 5:51
      // source here has a 6 s GOP, so a seek decodes ~90 frames). Falls back
      // to the original file on any miss (old build, encoder refuses, or a
      // preview that must not transcode).
      const proxyUrl =
        mode === "export"
          ? await seekProxyUrl(baseUrl, record, file, statSize, proxyMaxDim)
          : null;
      const servedUrl =
        proxyUrl ?? workspaceFileUrl(baseUrl, record.relativePath);
      next = next.split(`workspace://${id}`).join(servedUrl);
      servedUrls.push(servedUrl);
      continue;
    }
    const prepared = await prepareClipBytes(
      record.id,
      record.displayName,
      record.mimeType,
      file,
      statSize ?? 0,
      false,
    );
    const cacheUrl = cacheFileUrl(baseUrl, prepared.cacheName);
    next = next.split(`workspace://${id}`).join(cacheUrl);
    servedUrls.push(cacheUrl);
    if (prepared.warning) warnings.push(prepared.warning);
  }
  // A `file://` document loads these cross-origin, and drawing one would
  // taint the export canvas, so mark every served video CORS-approved.
  return { html: serveVideoCrossOrigin(next, servedUrls), files };
}

/**
 * Replaces every `workspace://<id>` audio-track reference with something the
 * export/preview WebViews can fetch. Shared by the `renderVideo` tool, the
 * `analyzeAudio` tool and the manual export button so all lanes behave the
 * same.
 *
 * Served lane (loopback asset server present): the reference becomes an
 * `http://127.0.0.1:<port>/files/…` URL — the same mechanism clips already
 * use. The file streams straight from disk, the tool never reads it into the
 * JS heap, and the document stays small no matter how long the soundtrack is;
 * that is what makes the larger `MAX_SERVED_AUDIO_FILE_BYTES` budget
 * practical.
 * Fallback lane (server unavailable): today's data URI, with the strict
 * `MAX_AUDIO_FILE_BYTES` budget that keeps the document small.
 */
export async function inlineAudioAssets(
  html: string,
  repository: WorkspaceRepository,
  mode: MediaPrepMode = "export",
): Promise<{ html: string; audioFiles: string[] }> {
  const ids = extractWorkspaceAudioIds(html);
  if (ids.length === 0) {
    return { html, audioFiles: [] };
  }

  const { ensureAssetServer, workspaceFileUrl } =
    await import("@/modules/preview/asset-server");
  const baseUrl = await ensureAssetServer().catch(() => null);
  if (!baseUrl) {
    return inlineAssetUris(
      html,
      repository,
      ids,
      "audio",
      assertAudioFileUsable,
    ).then(({ html: inlined, files }) => ({
      html: inlined,
      audioFiles: files,
    }));
  }

  const files: string[] = [];
  let next = html;
  // Soundtracks decode natively to a cacheable WAV once (see audioPcmUrl);
  // without a contract duration there is no sane decode bound, so those
  // documents keep today's whole-file lane.
  const audioBound = readContractDuration(html);
  for (const id of ids) {
    const record = await repository.getById(id);
    if (!record) {
      throw new Error(
        `No workspace audio file found with id ${id}. Save it to the workspace first, or remove its reference from the scene.`,
      );
    }
    const file = resolveWorkspaceFile(record.relativePath);
    if (!file.exists) {
      throw new Error(
        `File "${record.displayName}" is no longer available locally.`,
      );
    }
    // Stat-only gate: a 200 MB soundtrack must never be read into the JS
    // heap just to be validated. Unknown size still checks the format.
    const statSize = typeof file.size === "number" ? file.size : null;
    assertAudioFileUsable(
      record.displayName,
      record.mimeType,
      statSize,
      MAX_SERVED_AUDIO_FILE_BYTES,
    );
    files.push(record.displayName);
    const pcmUrl =
      mode === "export" && audioBound != null
        ? await audioPcmUrl(baseUrl, record, file, statSize, audioBound)
        : null;
    next = replaceWorkspaceAudioRef(
      next,
      id,
      pcmUrl ?? workspaceFileUrl(baseUrl, record.relativePath),
    );
  }
  return { html: next, audioFiles: files };
}
