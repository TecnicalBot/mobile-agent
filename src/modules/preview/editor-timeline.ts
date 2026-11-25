import type { EditorClipRenderResult } from "@/modules/preview/render-segments";

/**
 * Portable timeline files for an editor export package.
 *
 * Mobile editors (CapCut, KineMaster, VN/InShot) import media only, so their
 * path is the gallery album. Desktop NLEs additionally accept cut lists; this
 * module writes the formats that cover the common ones:
 *
 *  - FCPXML       Final Cut Pro, DaVinci Resolve
 *  - FCP7 XML     Premiere Pro, DaVinci Resolve
 *  - OTIO         Resolve, newer Premiere versions
 *  - CMX3600 EDL  last-resort cut list (media must be relinked)
 *  - shots.csv    human/machine-readable shot list
 *
 * Every media reference is relative (`clips/...`) so the package survives a
 * move; NLEs that cannot resolve relative paths prompt for relinking, which
 * the README explains.
 */

export type EditorTimelineInput = {
  name: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  clips: EditorClipRenderResult[];
  /** Album the clips were copied into, when the gallery save succeeded. */
  galleryAlbum?: string | null;
};

export type EditorTimelineFiles = {
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

  lines.push(`* TOTAL TIMELINE: ${timecode(fcp7Frames(duration, fps), timebase)}`);
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
  const albumLine = galleryAlbum
    ? `The finished video and every clip were also copied into the gallery album "${galleryAlbum}". Mobile editors import straight from there.`
    : "The clips were not copied to a gallery album (permission or export unavailable). Extract this package and import the `clips/` files from your file browser instead.";

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
    "MOBILE EDITORS (CapCut, KineMaster, VN, InShot, ...)",
    "  Mobile editors import media, not XML/EDL/OTIO. Open the gallery album",
    "  above (or import the extracted clips/ files), then add the clips to a new",
    "  project in order. The full video is the ready-to-share version.",
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
    fcpxml: fcpxml(safe),
    fcp7Xml: fcp7Xml(safe),
    otio: otio(safe),
    edl: edl(safe),
    csv: shotsCsv(safe),
    readme: readme(safe),
  };
}
