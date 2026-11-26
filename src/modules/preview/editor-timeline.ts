import type { EditorClipRenderResult } from "@/modules/preview/render-segments";
import type {
  VideoClipLayerPlan,
  VideoLayerPlan,
} from "@/modules/preview/video-render";

/**
 * Portable timeline files for an editor export package.
 *
 * Alight Motion is the one mobile editor that imports an editable project: it
 * reads its own `<scene>` XML. When the scene declares `layers` and `clips`,
 * each text/image/shape and each video window becomes its own editable layer;
 * otherwise the export falls back to one flattened video layer per shot, which
 * still opens as a correctly timed project but cannot be un-baked.
 *
 *  - Alight XML   Alight Motion project (editable layers)
 *  - FCPXML       Final Cut Pro, DaVinci Resolve
 *  - FCP7 XML     Premiere Pro, DaVinci Resolve
 *  - OTIO         Resolve, newer Premiere versions
 *  - CMX3600 EDL  last-resort cut list (media must be relinked)
 *  - shots.csv    human/machine-readable shot list
 *
 * Every media reference is relative (`clips/...`) so the package survives a
 * move; NLEs that cannot resolve relative paths prompt for relinking, which
 * the README explains. The Alight timeline prefers the gallery URIs because
 * Alight Motion cannot read media out of the package ZIP.
 */

export type EditorTimelineClip = EditorClipRenderResult & {
  /** Device media-store URI of the gallery copy, when the album save succeeded. */
  mediaUri?: string | null;
  /** Byte size of the rendered clip, when known. */
  mediaSize?: number | null;
};

/** A source file copied to the gallery for an editable Alight layer. */
export type EditorAlightMedia = {
  fileId?: string | null;
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  /** Source length in seconds, when known. */
  duration?: number | null;
};

export type EditorTimelineInput = {
  name: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  clips: EditorTimelineClip[];
  /** Declarative text/image/shape layers, rendered as editable Alight layers. */
  alightLayers?: VideoLayerPlan[];
  /** Declared video windows; replaces the flattened shot layers when resolved. */
  alightClips?: VideoClipLayerPlan[];
  /** Gallery copies of the original clips/images referenced above. */
  alightMedia?: EditorAlightMedia[];
  /** Album the clips were copied into, when the gallery save succeeded. */
  galleryAlbum?: string | null;
};

export type EditorTimelineFiles = {
  alightXml: string;
  fcpxml: string;
  fcp7Xml: string;
  otio: string;
  edl: string;
  csv: string;
  readme: string;
};

const EPSILON = 1e-6;

/** Frame duration of `fps` as a rational number of seconds. */
function frameDuration(fps: number): { num: number; den: number } {
  if (Math.abs(fps - 29.97) < 0.01) return { num: 1001, den: 30000 };
  if (Math.abs(fps - 59.94) < 0.01) return { num: 1001, den: 60000 };
  if (Math.abs(fps - 23.976) < 0.01) return { num: 1001, den: 24000 };
  if (Number.isInteger(fps)) return { num: 1, den: fps };
  // Keep a useful exact-ish rate for uncommon fractional contracts.
  return { num: 1000, den: Math.round(fps * 1000) };
}

function frameCount(seconds: number, fps: number) {
  const { num, den } = frameDuration(fps);
  return Math.max(0, Math.round((seconds * den) / num));
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

/** `900` at 30 fps -> `30/1s`; always a valid FCPXML rational time. */
function fcpxTime(frames: number, fps: number) {
  const { num, den } = frameDuration(fps);
  const numerator = frames * num;
  const divisor = gcd(numerator, den);
  return `${numerator / divisor}/${den / divisor}s`;
}

function fcp7Rate(fps: number) {
  if (Math.abs(fps - 29.97) < 0.01) return { timebase: 30, ntsc: true };
  if (Math.abs(fps - 59.94) < 0.01) return { timebase: 60, ntsc: true };
  if (Math.abs(fps - 23.976) < 0.01) return { timebase: 24, ntsc: true };
  return { timebase: Math.max(1, Math.round(fps)), ntsc: false };
}

function fcp7Frames(seconds: number, fps: number) {
  return Math.max(0, Math.round(seconds * fcp7Rate(fps).timebase));
}

function timecode(frames: number, timebase: number) {
  const total = Math.max(0, Math.round(frames));
  const ff = total % timebase;
  const totalSeconds = Math.floor(total / timebase);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function xml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function csvCell(value: string | number | boolean) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Alight Motion reads its own `<scene>` XML, not FCPXML/FCP7 XML. */
const ALIGHT_APP = "com.alightcreative.motion/5.0.273.1028425";

function coord(value: number) {
  return value.toFixed(6);
}

/**
 * The gallery copy is the only clip location Alight Motion can read: files
 * inside the delivered ZIP are not on the device, and app-internal paths are
 * outside its storage scope. Fall back to the package-relative path so the
 * import still shows correctly timed placeholder layers the user can relink.
 */
function alightMediaUri(clip: EditorTimelineClip) {
  return clip.mediaUri?.trim() || `clips/${clip.fileName}`;
}

type AlightKey = {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
};

/** Alight wants `#AARRGGBB`; accept `#RRGGBB` and default to opaque white. */
function alightColor(value: string | undefined, fallback = "#FFFFFFFF") {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec((value ?? "").trim());
  if (!match) return fallback;
  return match[1].length === 6
    ? `#FF${match[1].toUpperCase()}`
    : `#${match[1].toUpperCase()}`;
}

/** A bare family name becomes an Alight Google-Fonts descriptor. */
function alightFont(family: string | undefined, weight: number | undefined) {
  const name = (family ?? "").trim();
  if (!name) return null;
  if (/[?&]/.test(name)) return name;
  const value = Number.isFinite(weight) ? Math.round(weight ?? 400) : 400;
  return `googlefonts?name=${encodeURIComponent(name)}&weight=${value}`;
}

/**
 * Expands a layer's transform keys, anchoring the animation to the layer
 * window. Missing fields fall back to the layer's static value, and the first
 * and last frames are always present so Alight interpolates the full window.
 */
function alightKeys(layer: VideoLayerPlan): AlightKey[] {
  const base: AlightKey = {
    t: 0,
    x: layer.x,
    y: layer.y,
    w: layer.w,
    h: layer.h,
    rotation: layer.rotation,
    opacity: layer.opacity,
  };
  const raw = (layer.keys ?? []).map((key) => {
    const next: AlightKey = { ...base, t: key.t };
    if (key.x != null) next.x = key.x;
    if (key.y != null) next.y = key.y;
    if (key.w != null) next.w = key.w;
    if (key.h != null) next.h = key.h;
    if (key.rotation != null) next.rotation = key.rotation;
    if (key.opacity != null) next.opacity = key.opacity;
    return next;
  });
  if (raw.length === 0) return [];
  const keys = raw.sort((a, b) => a.t - b.t);
  if (keys[0].t > 0) keys.unshift({ ...base, t: 0 });
  if (keys[keys.length - 1].t < 1) {
    keys.push({ ...keys[keys.length - 1], t: 1 });
  }
  const out: AlightKey[] = [];
  for (const key of keys) {
    const t = Math.min(1, Math.max(0, key.t));
    if (out.length > 0 && Math.abs(t - out[out.length - 1].t) < 1e-6) {
      out[out.length - 1] = { ...key, t };
    } else {
      out.push({ ...key, t });
    }
  }
  return out.length > 1 ? out : [];
}

/** A keyable Alight value: one static attribute, or `<kf>` children. */
function alightKeyed(
  tag: string,
  values: { t: number; v: string }[],
  indent: string,
  attributes = "",
) {
  const distinct = new Set(values.map((value) => value.v));
  if (distinct.size <= 1) {
    return `${indent}<${tag}${attributes} value="${values[0]?.v ?? ""}"/>`;
  }
  return [
    `${indent}<${tag}${attributes}>`,
    ...values.map(
      (value) => `${indent}  <kf t="${coord(value.t)}" v="${value.v}"/>`,
    ),
    `${indent}</${tag}>`,
  ].join("\n");
}

function alightTransform(layer: VideoLayerPlan, indent: string) {
  const keys = alightKeys(layer);
  const values: AlightKey[] =
    keys.length > 0
      ? keys
      : [
          {
            t: 0,
            x: layer.x,
            y: layer.y,
            w: layer.w,
            h: layer.h,
            rotation: layer.rotation,
            opacity: layer.opacity,
          },
        ];
  return [
    `${indent}<transform>`,
    alightKeyed(
      "location",
      values.map((key) => ({
        t: key.t,
        v: `${coord(key.x + key.w / 2)},${coord(key.y + key.h / 2)},0.000000`,
      })),
      `${indent}  `,
    ),
    alightKeyed(
      "rotation",
      values.map((key) => ({ t: key.t, v: coord(key.rotation) })),
      `${indent}  `,
    ),
    alightKeyed(
      "opacity",
      values.map((key) => ({ t: key.t, v: coord(key.opacity) })),
      `${indent}  `,
    ),
    `${indent}</transform>`,
  ].join("\n");
}

/** `.rect` spans ±size, so half the box in each axis is the layer's size. */
function alightSizeProperty(layer: VideoLayerPlan, indent: string) {
  const keys = alightKeys(layer);
  const values =
    keys.length > 0
      ? keys
      : [
          {
            t: 0,
            x: layer.x,
            y: layer.y,
            w: layer.w,
            h: layer.h,
            rotation: layer.rotation,
            opacity: layer.opacity,
          },
        ];
  return alightKeyed(
    "property",
    values.map((key) => ({
      t: key.t,
      v: `${coord(key.w / 2)},${coord(key.h / 2)}`,
    })),
    indent,
    ' name="size" type="vec2"',
  );
}

function alightMediaElement(media: {
  uri: string;
  name: string;
  title?: string;
  mimeType: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}) {
  const attributes = [
    `uri="${xml(media.uri)}"`,
    `filename="${xml(media.name)}"`,
    `title="${xml(media.title ?? media.name)}"`,
    `type="${xml(media.mimeType)}"`,
  ];
  if (typeof media.size === "number" && media.size > 0) {
    attributes.push(`size="${Math.round(media.size)}"`);
  }
  if (typeof media.duration === "number" && media.duration > 0) {
    attributes.push(`duration="${Math.round(media.duration * 1000)}"`);
  }
  if (typeof media.width === "number" && media.width > 0) {
    attributes.push(`width="${Math.round(media.width)}"`);
  }
  if (typeof media.height === "number" && media.height > 0) {
    attributes.push(`height="${Math.round(media.height)}"`);
  }
  return `  <media ${attributes.join(" ")}/>`;
}

function alightXml(input: EditorTimelineInput) {
  const {
    alightClips,
    alightLayers,
    alightMedia,
    clips,
    duration,
    fps,
    height,
    name,
    width,
  } = input;
  const totalTime = Math.max(0, Math.round(duration * 1000));
  const mediaByFileId = new Map<string, EditorAlightMedia>();
  for (const media of alightMedia ?? []) {
    if (media.fileId) mediaByFileId.set(media.fileId, media);
  }

  // Original clips replace the flattened shot renders only when every declared
  // window resolved to a gallery copy; a partial set would silently drop
  // footage, so fall back to the complete shot list instead.
  const declaredClips = (alightClips ?? []).filter(
    (clip) => clip.fileId && mediaByFileId.has(clip.fileId),
  );
  const useDeclaredClips =
    declaredClips.length > 0 &&
    declaredClips.length === (alightClips ?? []).length;

  const mediaDeclarations: string[] = [];
  const seenMedia = new Set<string>();
  const pushMedia = (media: EditorAlightMedia) => {
    if (seenMedia.has(media.uri)) return;
    seenMedia.add(media.uri);
    mediaDeclarations.push(alightMediaElement(media));
  };

  const elements: { z: number; order: number; xml: string }[] = [];
  let order = 0;
  let id = 1;

  if (useDeclaredClips) {
    for (const clip of declaredClips) {
      const media = mediaByFileId.get(clip.fileId!)!;
      pushMedia(media);
      const start = Math.min(
        totalTime,
        Math.max(0, Math.round(clip.start * 1000)),
      );
      const end = Math.min(
        totalTime,
        Math.max(start, Math.round(clip.end * 1000)),
      );
      if (end <= start) continue;
      const rect =
        clip.x != null && clip.y != null && clip.w != null && clip.h != null
          ? { x: clip.x, y: clip.y, w: clip.w, h: clip.h }
          : { x: 0, y: 0, w: width, h: height };
      const inTime = Math.max(0, Math.round(clip.from * 1000));
      const outTime = inTime + (end - start);
      elements.push({
        z: 0,
        order: order++,
        xml: [
          `  <shape id="${id++}" label="${xml(clip.label)}" startTime="${start}" endTime="${end}" fillType="media" fillVideo="${xml(media.uri)}" inTime="${inTime}" outTime="${outTime}" mediaFillMode="${clip.fit === "fit" ? "fit" : "fill"}" s=".rect">`,
          "    <transform>",
          `      <location value="${coord(rect.x + rect.w / 2)},${coord(rect.y + rect.h / 2)},0.000000"/>`,
          `      <opacity value="${coord(clip.opacity ?? 1)}"/>`,
          "    </transform>",
          `    <property name="size" type="vec2" value="${coord(rect.w / 2)},${coord(rect.h / 2)}"/>`,
          "  </shape>",
        ].join("\n"),
      });
    }
  } else {
    // Flattened fallback: one full-frame video layer per shot/gap.
    for (const clip of clips) {
      const start = Math.min(
        totalTime,
        Math.max(0, Math.round(clip.start * 1000)),
      );
      const end = Math.min(
        totalTime,
        Math.max(start, Math.round(clip.end * 1000)),
      );
      if (end <= start) continue;
      const uri = alightMediaUri(clip);
      if (!seenMedia.has(uri)) {
        seenMedia.add(uri);
        mediaDeclarations.push(
          alightMediaElement({
            uri,
            name: clip.fileName,
            title: clip.label,
            mimeType: "video/mp4",
            size: clip.mediaSize,
            width,
            height,
            duration: clip.duration,
          }),
        );
      }
      elements.push({
        z: 0,
        order: order++,
        xml: [
          `  <shape id="${id++}" label="${xml(clip.label)}" startTime="${start}" endTime="${end}" fillType="media" fillVideo="${xml(uri)}" inTime="0" mediaFillMode="fill" s=".rect">`,
          "    <transform>",
          `      <location value="${coord(width / 2)},${coord(height / 2)},0.000000"/>`,
          "    </transform>",
          `    <property name="size" type="vec2" value="${coord(width / 2)},${coord(height / 2)}"/>`,
          "  </shape>",
        ].join("\n"),
      });
    }
  }

  for (const layer of alightLayers ?? []) {
    const start = Math.min(
      totalTime,
      Math.max(0, Math.round(layer.start * 1000)),
    );
    const end = Math.min(
      totalTime,
      Math.max(start, Math.round(layer.end * 1000)),
    );
    if (end <= start) continue;
    const z = Number.isFinite(layer.z) ? layer.z : order + 1;

    if (layer.type === "text") {
      const font = alightFont(layer.fontFamily, layer.fontWeight);
      const attributes = [
        `id="${id++}"`,
        `label="${xml(layer.label)}"`,
        `startTime="${start}"`,
        `endTime="${end}"`,
        'fillType="color"',
        `size="${Math.round(layer.fontSize ?? 48)}"`,
        ...(font ? [`font="${xml(font)}"`] : []),
        `wrapWidth="${Math.round(layer.w)}"`,
        `align="${layer.align ?? "center"}"`,
      ];
      elements.push({
        z,
        order: order++,
        xml: [
          `  <text ${attributes.join(" ")}>`,
          alightTransform(layer, "    "),
          `    <fillColor value="${alightColor(layer.color)}"/>`,
          `    <content>${xml(layer.text ?? "")}</content>`,
          "  </text>",
        ].join("\n"),
      });
      continue;
    }

    if (layer.type === "image") {
      const media = layer.fileId ? mediaByFileId.get(layer.fileId) : null;
      if (!media) continue;
      pushMedia(media);
      elements.push({
        z,
        order: order++,
        xml: [
          `  <shape id="${id++}" label="${xml(layer.label)}" startTime="${start}" endTime="${end}" fillType="media" fillImage="${xml(media.uri)}" mediaFillMode="${layer.fit === "fit" ? "fit" : "fill"}" s=".rect">`,
          alightTransform(layer, "    "),
          alightSizeProperty(layer, "    "),
          "  </shape>",
        ].join("\n"),
      });
      continue;
    }

    elements.push({
      z,
      order: order++,
      xml: [
        `  <shape id="${id++}" label="${xml(layer.label)}" startTime="${start}" endTime="${end}" fillType="color" s=".rect">`,
        alightTransform(layer, "    "),
        `    <fillColor value="${alightColor(layer.fill)}"/>`,
        alightSizeProperty(layer, "    "),
        ...(layer.radius && layer.radius > 0
          ? [
              `    <property name="cornerRadius" type="float" value="${coord(layer.radius)}"/>`,
            ]
          : []),
        "  </shape>",
      ].join("\n"),
    });
  }

  // Alight paints elements back-to-front in document order.
  elements.sort((a, b) => a.z - b.z || a.order - b.order);

  return [
    "<?xml version='1.0' encoding='UTF-8' ?>",
    `<scene title="${xml(name)}" width="${width}" height="${height}" exportWidth="${width}" exportHeight="${height}" bgcolor="#FF000000" totalTime="${totalTime}" fps="${fps}" modifiedTime="${Date.now()}" amver="106" ffver="106" am="${ALIGHT_APP}" amplatform="android">`,
    ...mediaDeclarations,
    ...elements.map((element) => element.xml),
    "</scene>",
    "",
  ].join("\n");
}

function rateBlock(fps: number, indent: string) {
  const { timebase, ntsc } = fcp7Rate(fps);
  return [
    `${indent}<rate>`,
    `${indent}  <timebase>${timebase}</timebase>`,
    `${indent}  <ntsc>${ntsc ? "TRUE" : "FALSE"}</ntsc>`,
    `${indent}</rate>`,
  ].join("\n");
}

function fcpxml(input: EditorTimelineInput) {
  const { clips, duration, fps, height, name, width } = input;
  const totalFrames = frameCount(duration, fps);
  const formatName = `FFVideoFormat${width}x${height}p${Math.round(fps)}`;

  const assets = clips
    .map((clip, index) => {
      const durationFrames = frameCount(clip.duration, fps);
      const audio = clip.hasAudio
        ? ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48k"'
        : ' hasAudio="0"';
      return [
        `    <asset id="a${index + 1}" name="${xml(clip.fileName)}" start="${fcpxTime(0, fps)}" duration="${fcpxTime(durationFrames, fps)}" hasVideo="1"${audio}>`,
        `      <media-rep kind="original-media" src="clips/${xml(clip.fileName)}"/>`,
        `    </asset>`,
      ].join("\n");
    })
    .join("\n");

  const spine = clips
    .map((clip, index) => {
      const startFrames = frameCount(clip.start, fps);
      const endFrames = frameCount(clip.end, fps);
      const clipFrames = Math.max(0, endFrames - startFrames);
      return `          <asset-clip ref="a${index + 1}" name="${xml(clip.label)}" offset="${fcpxTime(startFrames, fps)}" start="${fcpxTime(0, fps)}" duration="${fcpxTime(clipFrames, fps)}"/>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE fcpxml>",
    '<fcpxml version="1.11">',
    "  <resources>",
    `    <format id="r1" name="${xml(formatName)}" frameDuration="${fcpxTime(1, fps)}" width="${width}" height="${height}"/>`,
    assets,
    "  </resources>",
    "  <library>",
    `    <event name="${xml(name)}">`,
    `      <project name="${xml(name)}">`,
    `        <sequence format="r1" duration="${fcpxTime(totalFrames, fps)}" tcStart="${fcpxTime(0, fps)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    "          <spine>",
    spine,
    "          </spine>",
    "        </sequence>",
    "      </project>",
    "    </event>",
    "  </library>",
    "</fcpxml>",
    "",
  ].join("\n");
}

function fcp7Xml(input: EditorTimelineInput) {
  const { clips, duration, fps, name } = input;
  const totalFrames = fcp7Frames(duration, fps);
  const videoItems = clips
    .map((clip, index) => {
      const start = fcp7Frames(clip.start, fps);
      const end = fcp7Frames(clip.end, fps);
      const clipFrames = Math.max(0, end - start);
      const src = `clips/${xml(clip.fileName)}`;
      const audio = clip.hasAudio
        ? [
            "              <media>",
            "                <video>",
            `                  <samplecharacteristics><width>${input.width}</width><height>${input.height}</height></samplecharacteristics>`,
            "                </video>",
            "                <audio>",
            "                  <samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics>",
            "                  <channelcount>2</channelcount>",
            "                </audio>",
            "              </media>",
          ].join("\n")
        : [
            "              <media>",
            "                <video>",
            `                  <samplecharacteristics><width>${input.width}</width><height>${input.height}</height></samplecharacteristics>`,
            "                </video>",
            "              </media>",
          ].join("\n");
      return [
        `          <clipitem id="clipitem-${index + 1}">`,
        `            <name>${xml(clip.fileName)}</name>`,
        `            <duration>${clipFrames}</duration>`,
        rateBlock(fps, "            "),
        `            <start>${start}</start>`,
        `            <end>${end}</end>`,
        "            <in>0</in>",
        `            <out>${clipFrames}</out>`,
        `            <file id="file-${index + 1}">`,
        `              <name>${xml(clip.fileName)}</name>`,
        `              <pathurl>${src}</pathurl>`,
        rateBlock(fps, "              "),
        `              <duration>${clipFrames}</duration>`,
        "              <timecode>",
        rateBlock(fps, "                "),
        "                <string>00:00:00:00</string>",
        "                <frame>0</frame>",
        "                <displayformat>NDF</displayformat>",
        "              </timecode>",
        audio,
        "            </file>",
        "          </clipitem>",
      ].join("\n");
    })
    .join("\n");

  const audioItems = clips
    .filter((clip) => clip.hasAudio)
    .map((clip, index) => {
      const start = fcp7Frames(clip.start, fps);
      const end = fcp7Frames(clip.end, fps);
      const clipFrames = Math.max(0, end - start);
      const src = `clips/${xml(clip.fileName)}`;
      return [
        `          <clipitem id="clipitem-audio-${index + 1}">`,
        `            <name>${xml(clip.fileName)}</name>`,
        `            <duration>${clipFrames}</duration>`,
        rateBlock(fps, "            "),
        `            <start>${start}</start>`,
        `            <end>${end}</end>`,
        "            <in>0</in>",
        `            <out>${clipFrames}</out>`,
        "            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>",
        `            <file id="file-audio-${index + 1}">`,
        `              <name>${xml(clip.fileName)}</name>`,
        `              <pathurl>${src}</pathurl>`,
        rateBlock(fps, "              "),
        `              <duration>${clipFrames}</duration>`,
        "              <media>",
        "                <audio>",
        "                  <samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics>",
        "                  <channelcount>2</channelcount>",
        "                </audio>",
        "              </media>",
        "            </file>",
        "          </clipitem>",
      ].join("\n");
    })
    .join("\n");

  const audioTrack =
    audioItems.length > 0
      ? [
          "      <audio>",
          "        <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>",
          "        <track>",
          audioItems,
          "        </track>",
          "      </audio>",
        ].join("\n")
      : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    `    <name>${xml(name)}</name>`,
    `    <duration>${totalFrames}</duration>`,
    rateBlock(fps, "    "),
    "    <timecode>",
    rateBlock(fps, "      "),
    "      <string>00:00:00:00</string>",
    "      <frame>0</frame>",
    "      <displayformat>NDF</displayformat>",
    "    </timecode>",
    "    <media>",
    "      <video>",
    `        <format><samplecharacteristics><width>${input.width}</width><height>${input.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>`,
    "        <track>",
    videoItems,
    "        </track>",
    "      </video>",
    audioTrack,
    "    </media>",
    "  </sequence>",
    "</xmeml>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function rationalTime(frames: number, fps: number) {
  return {
    OTIO_SCHEMA: "RationalTime.1",
    rate: fps,
    value: frames,
  };
}

function timeRange(frames: number, fps: number) {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rationalTime(0, fps),
    duration: rationalTime(frames, fps),
  };
}

function otio(input: EditorTimelineInput) {
  const { clips, fps, name } = input;
  const children = clips.map((clip) => {
    const frames = frameCount(clip.duration, fps);
    const metadata: Record<string, unknown> = {};
    if (clip.shotId) metadata.mobile_agent_shot = clip.shotId;
    return {
      OTIO_SCHEMA: "Clip.2",
      name: clip.label,
      metadata,
      source_range: timeRange(frames, fps),
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        name: clip.fileName,
        metadata: {},
        target_url: `clips/${clip.fileName}`,
        available_range: timeRange(frames, fps),
      },
    };
  });

  const timeline = {
    OTIO_SCHEMA: "Timeline.1",
    name,
    global_start_time: rationalTime(0, fps),
    metadata: {},
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      metadata: {},
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          name: "Video 1",
          kind: "Video",
          metadata: {},
          children,
        },
      ],
    },
  };

  return `${JSON.stringify(timeline, null, 2)}\n`;
}

function edl(input: EditorTimelineInput) {
  const { clips, duration, fps, name } = input;
  const { timebase } = fcp7Rate(fps);
  const lines = [
    `TITLE: ${name.replace(/[\r\n]+/g, " ")}`,
    "FCM: NON-DROP FRAME",
    "",
  ];

  clips.forEach((clip, index) => {
    const start = fcp7Frames(clip.start, fps);
    const end = fcp7Frames(clip.end, fps);
    const clipFrames = Math.max(0, end - start);
    const reel = `CLIP${String(index + 1).padStart(3, "0")}`;
    const channel = clip.hasAudio ? "AA/V" : "V";
    lines.push(
      `${String(index + 1).padStart(3, "0")}  ${reel.padEnd(8)} ${channel.padEnd(5)} C        ${timecode(0, timebase)} ${timecode(clipFrames, timebase)} ${timecode(start, timebase)} ${timecode(end, timebase)}`,
    );
    lines.push(`* FROM CLIP NAME: ${clip.fileName}`);
    lines.push(`* SOURCE FILE: clips/${clip.fileName}`);
    lines.push("");
  });

  lines.push(
    `* TOTAL TIMELINE: ${timecode(fcp7Frames(duration, fps), timebase)}`,
  );
  return `${lines.join("\n")}\n`;
}

function shotsCsv(input: EditorTimelineInput) {
  const rows = [
    [
      "index",
      "file",
      "label",
      "start_seconds",
      "end_seconds",
      "duration_seconds",
      "has_audio",
      "shot_id",
    ].join(","),
  ];
  input.clips.forEach((clip, index) => {
    rows.push(
      [
        index + 1,
        csvCell(`clips/${clip.fileName}`),
        csvCell(clip.label),
        clip.start,
        clip.end,
        clip.duration,
        clip.hasAudio,
        clip.shotId ?? "",
      ].join(","),
    );
  });
  return `${rows.join("\n")}\n`;
}

function readme(input: EditorTimelineInput) {
  const { clips, duration, fps, galleryAlbum, height, name, width } = input;
  const hasLayers = (input.alightLayers?.length ?? 0) > 0;
  const hasClips = (input.alightClips?.length ?? 0) > 0;
  const albumLine = galleryAlbum
    ? `The finished video, every clip, and any original layer images/videos were also copied into the gallery album "${galleryAlbum}". Alight Motion's timeline and the other mobile editors read the media from there.`
    : "The media was not copied to a gallery album (permission or export unavailable). Extract this package and import the `clips/` files from your file browser instead; timeline-alight.xml will need its media relinked.";

  return [
    `${name} — editor package`,
    "=".repeat(48),
    "",
    `Video: ${width}x${height}, ${fps} fps, ${duration.toFixed(2)} s, H.264 video + AAC audio (MP4).`,
    `Clips: ${clips.length} file${clips.length === 1 ? "" : "s"} in timeline order.`,
    "",
    albumLine,
    "",
    "WHAT IS IN THIS PACKAGE",
    "  clips/            One MP4 per shot (or gap between shots), in timeline order.",
    "  timeline-alight.xml Alight Motion project (editable layers when declared).",
    "  timeline.fcpxml  FCPXML 1.11 (Final Cut Pro, DaVinci Resolve).",
    "  timeline-fcp7.xml FCP7 XML / xmeml v4 (Premiere Pro, DaVinci Resolve).",
    "  timeline.otio    OpenTimelineIO timeline (Resolve, newer Premiere).",
    "  timeline.edl     CMX3600 cut list fallback.",
    "  shots.csv        Shot list with exact seconds.",
    "",
    "The finished full video is delivered separately in the app (and copied to",
    "the gallery album) so it is not duplicated inside this ZIP. Rebuild it on",
    "your editor timeline from clips/, or use the separate full video as-is.",
    "",
    "ALIGHT MOTION",
    "  Import timeline-alight.xml: open Alight Motion, go to Templates > Upload,",
    "  then pick the XML (or share the file to Alight Motion from your file",
    "  manager).",
    ...(hasLayers || hasClips
      ? [
          "  It opens as an editable project: text, image, and shape layers are",
          "  separate, and each declared video clip keeps its own window and",
          "  trim. The layers point at the files in the gallery album above, so",
          "  keep that album intact. If a layer shows as missing media, tap it",
          "  and replace it with the matching album or clips/ file.",
        ]
      : [
          "  It opens as a correctly timed project with one full-frame video",
          "  layer per shot. Those layers are flattened renders, not separate",
          "  text/image overlays: declare `layers` in the MOBILE_AGENT_VIDEO",
          "  contract to export editable elements. The layers point at the clips",
          "  in the gallery album above, so keep that album intact.",
        ]),
    `  A standalone copy is saved to Downloads as "${name}-alight.xml", so it`,
    "  can be imported without extracting this ZIP.",
    "",
    "OTHER MOBILE EDITORS (CapCut, KineMaster, VN, InShot, ...)",
    "  These import media, not project XML. Open the gallery album above (or",
    "  import the extracted clips/ files), then add the clips to a new project",
    "  in order. The full video is the ready-to-share version.",
    "",
    "CAPCUT DESKTOP",
    "  Import the clips/ files (or the finished video) from Media > Import.",
    "  CapCut desktop does not import FCPXML/FCP7 XML/EDL/OTIO.",
    "",
    "PREMIERE PRO",
    "  File > Import > timeline-fcp7.xml. If Premiere asks for media, point it at",
    "  the clips/ folder in this package. Keep the folder structure intact.",
    "",
    "DAVINCI RESOLVE",
    "  File > Import > Timeline > timeline.fcpxml (or timeline.otio). Media is",
    "  resolved relative to clips/; relink if you moved files out of the package.",
    "",
    "FINAL CUT PRO",
    "  File > Import > XML > timeline.fcpxml. Media resolves relative to clips/.",
    "",
    "NOTES",
    "  - Keep timeline files next to the clips/ folder; paths are relative.",
    "  - Each clip is trimmed to its shot window. Shot order is the timeline order.",
    "  - Audio is AAC stereo. Very short fades may exist at internal segment seams.",
    "  - timeline.edl is a fallback: EDL carries reel names, so relink media if",
    "    your editor asks, or use one of the XML timelines instead.",
    "",
  ].join("\n");
}

export function buildEditorTimelineFiles(
  input: EditorTimelineInput,
): EditorTimelineFiles {
  const safe: EditorTimelineInput = {
    ...input,
    duration: Math.max(0, input.duration),
    fps: input.fps > 0 ? input.fps : 30,
    clips: input.clips.map((clip) => ({
      ...clip,
      duration: Math.max(0, clip.end - clip.start),
    })),
  };
  if (safe.clips.length === 0) {
    throw new Error("An editor package needs at least one clip.");
  }
  if (safe.duration <= EPSILON) {
    throw new Error("An editor package needs a positive timeline duration.");
  }
  return {
    alightXml: alightXml(safe),
    fcpxml: fcpxml(safe),
    fcp7Xml: fcp7Xml(safe),
    otio: otio(safe),
    edl: edl(safe),
    csv: shotsCsv(safe),
    readme: readme(safe),
  };
}
