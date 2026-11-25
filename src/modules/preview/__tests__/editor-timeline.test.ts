import { describe, expect, it } from "vitest";

import { buildEditorTimelineFiles } from "@/modules/preview/editor-timeline";
import type { EditorClipRenderResult } from "@/modules/preview/render-segments";

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
    expect(fcpxml).toContain(
      'frameDuration="1/30s" width="1280" height="720"',
    );
    // 15 s at 30 fps.
    expect(fcpxml).toContain('duration="15/1s"');
    expect(fcpxml).toContain('src="clips/01-intro.mp4"');
    expect(fcpxml).toContain('src="clips/02-gap-1.mp4"');
    expect(fcpxml).toContain('name="payoff &amp; &lt;end&gt;"');
    expect(fcpxml).toContain(
      'offset="0/1s" start="0/1s" duration="5/1s"',
    );
    expect(fcpxml).toContain(
      'offset="8/1s" start="0/1s" duration="7/1s"',
    );
    // Assets without audio do not claim audio sources.
    expect(fcpxml).toContain('name="02-gap-1.mp4" start="0/1s" duration="3/1s" hasVideo="1" hasAudio="0"');
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
    expect(
      fcp7Xml.match(/<clipitem id="clipitem-audio-\d+">/g),
    ).toHaveLength(2);
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
    expect(rows[2]).toContain('2,clips/02-gap-1.mp4,Gap 1,5,8,3,false,');
    expect(rows[3]).toContain("3,clips/03-payoff-end.mp4,payoff & <end>,8,15,7,true,payoff");
  });

  it("explains mobile and desktop imports in the README", () => {
    const { readme } = buildEditorTimelineFiles(input);

    expect(readme).toContain('gallery album "Mobile Agent Edits"');
    expect(readme).toContain("CapCut");
    expect(readme).toContain("KineMaster");
    expect(readme).toContain("Premiere Pro");
    expect(readme).toContain("DaVinci Resolve");
    expect(readme).toContain("Final Cut Pro");
    expect(readme).toContain("timeline.fcpxml");
  });

  it("warns that no album was created when gallery access failed", () => {
    const { readme } = buildEditorTimelineFiles({ ...input, galleryAlbum: null });
    expect(readme).toContain("not copied to a gallery album");
  });

  it("rejects packages with no clips or no duration", () => {
    expect(() =>
      buildEditorTimelineFiles({ ...input, clips: [] }),
    ).toThrow(/at least one clip/);
    expect(() =>
      buildEditorTimelineFiles({ ...input, duration: 0 }),
    ).toThrow(/positive timeline duration/);
  });
});
