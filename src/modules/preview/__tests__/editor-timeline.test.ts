import { describe, expect, it } from "vitest";

import { buildEditorTimelineFiles } from "@/modules/preview/editor-timeline";
import type { EditorClipRenderResult } from "@/modules/preview/render-segments";
import type {
  VideoClipLayerPlan,
  VideoLayerPlan,
} from "@/modules/preview/video-render";

const clips: EditorClipRenderResult[] = [
  {
    id: "shot-intro",
    label: "intro",
    fileName: "01-intro.mp4",
    uri: "file:///cache/editor/01-intro.mp4",
    start: 0,
    end: 5,
    duration: 5,
    hasAudio: true,
    shotId: "intro",
  },
  {
    id: "gap-1",
    label: "Gap 1",
    fileName: "02-gap-1.mp4",
    uri: "file:///cache/editor/02-gap-1.mp4",
    start: 5,
    end: 8,
    duration: 3,
    hasAudio: false,
  },
  {
    id: "shot-payoff",
    label: "payoff & <end>",
    fileName: "03-payoff-end.mp4",
    uri: "file:///cache/editor/03-payoff-end.mp4",
    start: 8,
    end: 15,
    duration: 7,
    hasAudio: true,
    shotId: "payoff",
  },
];

const input = {
  name: "black-hole",
  fps: 30,
  width: 1280,
  height: 720,
  duration: 15,
  clips,
  galleryAlbum: "Mobile Agent Edits",
};

describe("buildEditorTimelineFiles", () => {
  it("writes FCPXML with relative media and timeline-order clips", () => {
    const { fcpxml } = buildEditorTimelineFiles(input);

    expect(fcpxml).toContain('<fcpxml version="1.11">');
    expect(fcpxml).toContain('frameDuration="1/30s" width="1280" height="720"');
    // 15 s at 30 fps.
    expect(fcpxml).toContain('duration="15/1s"');
    expect(fcpxml).toContain('src="clips/01-intro.mp4"');
    expect(fcpxml).toContain('src="clips/02-gap-1.mp4"');
    expect(fcpxml).toContain('name="payoff &amp; &lt;end&gt;"');
    expect(fcpxml).toContain('offset="0/1s" start="0/1s" duration="5/1s"');
    expect(fcpxml).toContain('offset="8/1s" start="0/1s" duration="7/1s"');
    // Assets without audio do not claim audio sources.
    expect(fcpxml).toContain(
      'name="02-gap-1.mp4" start="0/1s" duration="3/1s" hasVideo="1" hasAudio="0"',
    );
  });

  it("writes FCP7 XML (xmeml v4) with video and audio tracks", () => {
    const { fcp7Xml } = buildEditorTimelineFiles(input);

    expect(fcp7Xml).toContain('<xmeml version="4">');
    expect(fcp7Xml).toContain("<duration>450</duration>");
    expect(fcp7Xml).toContain("<pathurl>clips/01-intro.mp4</pathurl>");
    expect(fcp7Xml).toContain('<clipitem id="clipitem-1">');
    expect(fcp7Xml).toContain('<clipitem id="clipitem-audio-1">');
    // Only the two clips with audio contribute audio clipitems; the silent gap
    // is video-only.
    expect(fcp7Xml.match(/<clipitem id="clipitem-audio-\d+">/g)).toHaveLength(
      2,
    );
    expect(fcp7Xml).toContain("<name>03-payoff-end.mp4</name>");
  });

  it("writes an OTIO timeline whose tracks reference the clips", () => {
    const { otio } = buildEditorTimelineFiles(input);
    const timeline = JSON.parse(otio);

    expect(timeline.OTIO_SCHEMA).toBe("Timeline.1");
    const track = timeline.tracks.children[0];
    expect(track.kind).toBe("Video");
    expect(track.children).toHaveLength(3);
    expect(track.children[0].media_reference.target_url).toBe(
      "clips/01-intro.mp4",
    );
    expect(track.children[0].source_range.duration).toEqual({
      OTIO_SCHEMA: "RationalTime.1",
      rate: 30,
      value: 150,
    });
    expect(track.children[2].metadata.mobile_agent_shot).toBe("payoff");
  });

  it("writes an Alight Motion scene with full-frame video layers", () => {
    const withMedia = clips.map((clip, index) => ({
      ...clip,
      mediaUri: `content://media/external/video/media/${index + 1}`,
      mediaSize: 1000 + index,
    }));
    const { alightXml } = buildEditorTimelineFiles({
      ...input,
      clips: withMedia,
    });

    expect(alightXml).toContain(
      '<scene title="black-hole" width="1280" height="720"',
    );
    expect(alightXml).toContain('totalTime="15000" fps="30"');
    expect(alightXml).toContain(
      '<media uri="content://media/external/video/media/1" filename="01-intro.mp4" title="intro" type="video/mp4" size="1000" duration="5000" width="1280" height="720"/>',
    );
    expect(alightXml).toContain(
      'fillType="media" fillVideo="content://media/external/video/media/3"',
    );
    expect(alightXml).toContain('startTime="8000" endTime="15000"');
    // The .rect template spans ±size, so half the canvas fills the frame.
    expect(alightXml).toContain(
      '<location value="640.000000,360.000000,0.000000"/>',
    );
    expect(alightXml).toContain(
      '<property name="size" type="vec2" value="640.000000,360.000000"/>',
    );
    expect(alightXml).toContain('label="payoff &amp; &lt;end&gt;"');
  });

  it("falls back to package-relative media for Alight Motion", () => {
    const { alightXml } = buildEditorTimelineFiles(input);

    expect(alightXml).toContain('fillVideo="clips/01-intro.mp4"');
    expect(alightXml).toContain('uri="clips/01-intro.mp4"');
  });

  it("writes declared text, image, and shape layers as editable layers", () => {
    const alightLayers: VideoLayerPlan[] = [
      {
        id: "title",
        type: "text",
        label: "Title",
        start: 0,
        end: 4,
        x: 80,
        y: 60,
        w: 1120,
        h: 140,
        rotation: 0,
        opacity: 1,
        z: 2,
        text: "Black holes",
        fontSize: 72,
        fontFamily: "Archivo Black",
        fontWeight: 700,
        color: "#FFFFFF",
        align: "center",
      },
      {
        id: "photo",
        type: "image",
        label: "Photo",
        start: 4,
        end: 9,
        x: 160,
        y: 120,
        w: 960,
        h: 540,
        rotation: 0,
        opacity: 0.9,
        z: 1,
        fileId: "img-1",
        fit: "fit",
        keys: [
          { t: 0, opacity: 0 },
          { t: 0.25, opacity: 0.9 },
        ],
      },
      {
        id: "bar",
        type: "shape",
        label: "Bar",
        start: 0,
        end: 15,
        x: 0,
        y: 620,
        w: 1280,
        h: 100,
        rotation: 0,
        opacity: 1,
        z: 3,
        fill: "#101820",
        radius: 24,
      },
    ];
    const { alightXml } = buildEditorTimelineFiles({
      ...input,
      alightLayers,
      alightMedia: [
        {
          fileId: "img-1",
          uri: "content://media/photo",
          name: "photo.jpg",
          mimeType: "image/jpeg",
          size: 1234,
        },
      ],
    });

    // Text becomes a native Alight text layer with the box's wrap width.
    expect(alightXml).toContain(
      '<text id="4" label="Title" startTime="0" endTime="4000" fillType="color" size="72" font="googlefonts?name=Archivo%20Black&amp;weight=700" wrapWidth="1120" align="center">',
    );
    expect(alightXml).toContain('<fillColor value="#FFFFFFFF"/>');
    expect(alightXml).toContain("<content>Black holes</content>");
    expect(alightXml).toContain(
      '<location value="640.000000,130.000000,0.000000"/>',
    );

    // Image keeps its own media and animates opacity on normalized time.
    expect(alightXml).toContain(
      '<shape id="5" label="Photo" startTime="4000" endTime="9000" fillType="media" fillImage="content://media/photo" mediaFillMode="fit" s=".rect">',
    );
    expect(alightXml).toContain("<opacity>");
    expect(alightXml).toContain('<kf t="0.000000" v="0.000000"/>');
    expect(alightXml).toContain('<kf t="0.250000" v="0.900000"/>');
    expect(alightXml).toContain(
      '<location value="640.000000,390.000000,0.000000"/>',
    );
    expect(alightXml).toContain(
      '<property name="size" type="vec2" value="480.000000,270.000000"/>',
    );

    // Shapes are native color layers with a corner radius.
    expect(alightXml).toContain(
      '<shape id="6" label="Bar" startTime="0" endTime="15000" fillType="color" s=".rect">',
    );
    expect(alightXml).toContain('<fillColor value="#FF101820"/>');
    expect(alightXml).toContain(
      '<property name="cornerRadius" type="float" value="24.000000"/>',
    );

    // z-order: flattened video (0), image (1), text (2), shape (3).
    const imageAt = alightXml.indexOf('label="Photo"');
    const textAt = alightXml.indexOf('label="Title"');
    const shapeAt = alightXml.indexOf('label="Bar"');
    expect(imageAt).toBeGreaterThan(-1);
    expect(imageAt).toBeLessThan(textAt);
    expect(textAt).toBeLessThan(shapeAt);
  });

  it("uses declared video windows as trimmed editable clips", () => {
    const alightClips: VideoClipLayerPlan[] = [
      { id: "base", label: "Base", start: 0, end: 5, from: 1, fileId: "vid-a" },
      {
        id: "overlay",
        label: "Overlay",
        start: 6,
        end: 9,
        from: 0,
        fileId: "vid-b",
        x: 700,
        y: 40,
        w: 480,
        h: 270,
      },
    ];
    const { alightXml } = buildEditorTimelineFiles({
      ...input,
      alightClips,
      alightMedia: [
        {
          fileId: "vid-a",
          uri: "content://media/a",
          name: "a.mp4",
          mimeType: "video/mp4",
          size: 100,
        },
        {
          fileId: "vid-b",
          uri: "content://media/b",
          name: "b.mp4",
          mimeType: "video/mp4",
          size: 200,
        },
      ],
    });

    expect(alightXml).toContain(
      '<shape id="1" label="Base" startTime="0" endTime="5000" fillType="media" fillVideo="content://media/a" inTime="1000" outTime="6000" mediaFillMode="fill" s=".rect">',
    );
    expect(alightXml).toContain(
      '<shape id="2" label="Overlay" startTime="6000" endTime="9000" fillType="media" fillVideo="content://media/b" inTime="0" outTime="3000" mediaFillMode="fill" s=".rect">',
    );
    expect(alightXml).toContain(
      '<location value="940.000000,175.000000,0.000000"/>',
    );
    expect(alightXml).toContain(
      '<property name="size" type="vec2" value="240.000000,135.000000"/>',
    );
    // The flattened shot renders are not used when originals resolve.
    expect(alightXml).not.toContain("clips/01-intro.mp4");
  });

  it("falls back to shot layers when a declared clip has no media", () => {
    const alightClips: VideoClipLayerPlan[] = [
      { id: "base", label: "Base", start: 0, end: 5, from: 0, fileId: "gone" },
    ];
    const { alightXml } = buildEditorTimelineFiles({
      ...input,
      alightClips,
      alightMedia: [],
    });

    expect(alightXml).toContain('fillVideo="clips/01-intro.mp4"');
    expect(alightXml).not.toContain('label="Base"');
  });

  it("writes a CMX3600 EDL with record timecodes", () => {
    const { edl } = buildEditorTimelineFiles(input);

    expect(edl).toContain("TITLE: black-hole");
    expect(edl).toContain("FCM: NON-DROP FRAME");
    expect(edl).toContain(
      "001  CLIP001  AA/V  C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00",
    );
    expect(edl).toContain(
      "003  CLIP003  AA/V  C        00:00:00:00 00:00:07:00 00:00:08:00 00:00:15:00",
    );
    expect(edl).toContain("* TOTAL TIMELINE: 00:00:15:00");
  });

  it("writes a CSV shot list with escaped labels", () => {
    const { csv } = buildEditorTimelineFiles(input);
    const rows = csv.trim().split("\n");

    expect(rows[0]).toBe(
      "index,file,label,start_seconds,end_seconds,duration_seconds,has_audio,shot_id",
    );
    expect(rows[1]).toContain("1,clips/01-intro.mp4,intro,0,5,5,true,intro");
    expect(rows[2]).toContain("2,clips/02-gap-1.mp4,Gap 1,5,8,3,false,");
    expect(rows[3]).toContain(
      "3,clips/03-payoff-end.mp4,payoff & <end>,8,15,7,true,payoff",
    );
  });

  it("explains mobile and desktop imports in the README", () => {
    const { readme } = buildEditorTimelineFiles(input);

    expect(readme).toContain('gallery album "Mobile Agent Edits"');
    expect(readme).toContain("Alight Motion");
    expect(readme).toContain("timeline-alight.xml");
    expect(readme).toContain("CapCut");
    expect(readme).toContain("KineMaster");
    expect(readme).toContain("Premiere Pro");
    expect(readme).toContain("DaVinci Resolve");
    expect(readme).toContain("Final Cut Pro");
    expect(readme).toContain("timeline.fcpxml");
  });

  it("warns that no album was created when gallery access failed", () => {
    const { readme } = buildEditorTimelineFiles({
      ...input,
      galleryAlbum: null,
    });
    expect(readme).toContain("not copied to a gallery album");
  });

  it("rejects packages with no clips or no duration", () => {
    expect(() => buildEditorTimelineFiles({ ...input, clips: [] })).toThrow(
      /at least one clip/,
    );
    expect(() => buildEditorTimelineFiles({ ...input, duration: 0 })).toThrow(
      /positive timeline duration/,
    );
  });
});
