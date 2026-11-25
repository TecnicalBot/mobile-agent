import { beforeEach, describe, expect, it, vi } from "vitest";

import { profileIdFor } from "@/modules/preview/render-backend";
import type {
  RenderBackend,
  SegmentArtifact,
  SegmentRequest,
} from "@/modules/preview/render-backend";

const mocks = vi.hoisted(() => ({
  requestVideoRender: vi.fn(),
  probeVideoPlan: vi.fn(),
  concatSegments: vi.fn(),
  files: new Map<string, { exists: boolean; content: string }>(),
  jobIndex: 0,
}));

function key(uri: string) {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

vi.mock("@/modules/preview/video-render", () => ({
  requestVideoRender: mocks.requestVideoRender,
  probeVideoPlan: mocks.probeVideoPlan,
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({}),
  resolveWorkspaceFile: vi.fn(),
}));

vi.mock("html-video-export", () => ({
  getHtmlVideoExportModule: () => ({ concatSegments: mocks.concatSegments }),
}));

vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache" } },
  Directory: class {
    uri: string;
    constructor(uriOrDir: string | { uri: string }, name?: string) {
      if (typeof uriOrDir === "string" && name !== undefined) {
        this.uri = `${uriOrDir}/cache/${name}`;
      } else if (typeof uriOrDir === "string") {
        this.uri = uriOrDir;
      } else {
        const base = uriOrDir.uri.replace(/\/$/, "");
        this.uri = name !== undefined ? `${base}/${name}` : base;
      }
    }
    get exists() {
      return [...mocks.files.keys()].some((path) =>
        path.startsWith(`${key(this.uri)}/`),
      );
    }
    create() {}
    delete() {
      for (const path of [...mocks.files.keys()]) {
        if (path.startsWith(`${key(this.uri)}/`)) mocks.files.delete(path);
      }
    }
    list() {
      const entries: { name: string; delete: () => void }[] = [];
      for (const path of [...mocks.files.keys()]) {
        if (!path.startsWith("/cache/")) continue;
        entries.push({
          name: path.slice("/cache/".length),
          delete: () => {
            mocks.files.delete(path);
          },
        });
      }
      return entries;
    }
  },
  File: class {
    uri: string;
    constructor(uriOrDir: string | { uri: string }, name?: string) {
      if (typeof uriOrDir === "string" && name !== undefined) {
        this.uri = `${uriOrDir}/cache/${name}`;
      } else if (typeof uriOrDir === "string") {
        this.uri = uriOrDir;
      } else {
        const base = uriOrDir.uri.replace(/\/$/, "");
        this.uri = name !== undefined ? `${base}/${name}` : base;
      }
    }
    get exists() {
      return mocks.files.get(key(this.uri))?.exists ?? false;
    }
    async bytes() {
      return new Uint8Array([1, 2, 3]);
    }
    async text() {
      return mocks.files.get(key(this.uri))?.content ?? "";
    }
    async write(content: string) {
      mocks.files.set(key(this.uri), { exists: true, content });
    }
    async move(dest: { uri: string }, _opts?: unknown) {
      mocks.files.set(key(dest.uri), { exists: true, content: "video" });
    }
    async delete() {
      mocks.files.delete(key(this.uri));
    }
  },
}));

const { renderSegments } = await import(
  "@/modules/tools/built-in/render-video"
);
const { hashSegmentKeys, planEditorClips, planShotSegments } = await import(
  "@/modules/preview/render-segments"
);

const DOC = "<html>MOBILE_AGENT_VIDEO</html>";

function segResult(index: number, hasAudio = true, encoder = "c2.samsung.avc.encoder") {
  return {
    uri: `file:///cache/job-seg-${index}.mp4`,
    hasAudio,
    audioWarnings: index === 0 ? ["first-seg-note"] : [],
    encoder,
    timings: {
      frames: 900,
      prepareAvgMs: 10,
      prepareMaxMs: 40,
      captureAvgMs: 5,
      captureMaxMs: 12,
      bridgeAvgMs: 3,
      bridgeMaxMs: 9,
      audioPrepMs: 50,
      pageLoadMs: 100,
      firstFrameMs: 400,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.jobIndex = 0;
  mocks.probeVideoPlan.mockReset();
  mocks.requestVideoRender.mockImplementation(async (_html: string, opts: { segment?: { offset: number; length: number }; onProgress?: (p: number) => void }) => {
    const seg = opts.segment;
    const index = seg ? Math.round(seg.offset / 45) : 0;
    opts.onProgress?.(0.5);
    opts.onProgress?.(1);
    const job = mocks.jobIndex++;
    return { ...segResult(index), uri: `file:///cache/job-seg-${job}.mp4` };
  });
  mocks.concatSegments.mockResolvedValue({ ok: true });
});

describe("renderSegments", () => {
  it("renders short timelines as one job with no segment args", async () => {
    const out = await renderSegments({
      conversationId: "chat-short",
      contractDuration: 20,
      documentHtml: DOC,
      sourceFileId: "src-1",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(1);
    expect(mocks.requestVideoRender).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({ segment: undefined, conversationId: "chat-short" }),
    );
    expect(mocks.concatSegments).not.toHaveBeenCalled();
    expect(out.uri).toBe("file:///cache/job-seg-0.mp4");
    expect(out.warnings).toEqual([]);
    expect(out.audioWarnings).toEqual(["first-seg-note"]);
    // Single-pass: wall time only, no concat; fixed costs pass through.
    expect(out.phases?.totalMs).toBeGreaterThanOrEqual(0);
    expect(out.phases?.concatMs).toBeUndefined();
    expect(out.phases?.pageLoadTotalMs).toBe(100);
    expect(out.phases?.firstFrameTotalMs).toBe(400);
    expect(out.phases?.audioPrepTotalMs).toBe(50);
  });

  it("splits long timelines into 45 s jobs and concatenates", async () => {
    const progress: number[] = [];
    const out = await renderSegments({
      conversationId: "chat-long",
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-2",
      onProgress: (p) => progress.push(p.bytesWritten / p.totalBytes * 100),
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    for (const [, options] of mocks.requestVideoRender.mock.calls) {
      expect(options.conversationId).toBe("chat-long");
    }
    const segments = mocks.requestVideoRender.mock.calls.map(
      (call) => (call[1] as { segment: { offset: number; length: number } }).segment,
    );
    expect(segments).toEqual([
      { offset: 0, length: 45 },
      { offset: 45, length: 20 },
    ]);
    expect(mocks.concatSegments).toHaveBeenCalledTimes(1);
    expect(out.warnings.join(" ")).toMatch(/2 segments/);
    expect(out.hasAudio).toBe(true);
    expect(progress[0]).toBeGreaterThanOrEqual(0);
    expect(progress[progress.length - 1]).toBeGreaterThan(progress[0]);
  });

  it("sums fixed per-segment costs across every fresh segment", async () => {
    const out = await renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-phases",
    });

    // Two fresh segments, each reporting 100/400/50 ms of fixed cost.
    expect(out.phases?.totalMs).toBeGreaterThanOrEqual(0);
    expect(out.phases?.concatMs).toBeGreaterThanOrEqual(0);
    expect(out.phases?.pageLoadTotalMs).toBe(200);
    expect(out.phases?.firstFrameTotalMs).toBe(800);
    expect(out.phases?.audioPrepTotalMs).toBe(100);
  });

  it("does not report 100 percent until joining has succeeded", async () => {
    const progress: number[] = [];
    mocks.concatSegments.mockImplementationOnce(async () => {
      expect(Math.max(...progress)).toBe(99);
      expect(progress).not.toContain(100);
    });
    await renderSegments({
      contractDuration: 65, documentHtml: DOC, sourceFileId: "src-progress",
      onProgress: (p) => progress.push(p.bytesWritten / p.totalBytes * 100),
    });
    expect(progress.at(-1)).toBe(100);
    expect(progress.filter((p) => p === 100)).toHaveLength(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("resumes by reusing finished segments and their audio flags", async () => {
    mocks.files.set("/cache/render-src-3@h264_mediacodec-unknown-yuv420p-seg-0-0-45.mp4", { exists: true, content: "video" });
    mocks.files.set(
      "/cache/render-src-3@h264_mediacodec-unknown-yuv420p-seg-0-0-45.json",
      { exists: true, content: JSON.stringify({ hasAudio: true, audioWarnings: ["kept-note"] }) },
    );
    const out = await renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-3",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(1);
    expect(out.hasAudio).toBe(true);
    expect(out.audioWarnings).toContain("kept-note");
    const concatArgs = mocks.concatSegments.mock.calls[0][0] as string[];
    expect(concatArgs).toHaveLength(2);
    expect(concatArgs[0]).toContain("seg-0-0-45");
  });

  it("never reuses segments rendered under a different segment length", async () => {
    // Footage cached by a build that segmented at 30 s: same document hash,
    // same index — but a 45 s run must not splice a 30 s window into a
    // 45 s timeline. Geometry in the cache name makes old entries invisible.
    mocks.files.set("/cache/render-src-layout@h264_mediacodec-unknown-yuv420p-seg-0-0-30.mp4", { exists: true, content: "video" });
    mocks.files.set("/cache/render-src-layout@h264_mediacodec-unknown-yuv420p-seg-0-0-30.json", {
      exists: true,
      content: JSON.stringify({ hasAudio: true, encoder: "c2.samsung.avc.encoder" }),
    });

    await renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-layout",
    });

    // Both segments rendered fresh; the stale 30 s files never entered concat.
    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    const concatArgs = mocks.concatSegments.mock.calls[0][0] as string[];
    expect(concatArgs).toHaveLength(2);
    expect(concatArgs.some((uri) => uri.includes("-0-30"))).toBe(false);
  });

  it("names the failed segment and its time range", async () => {
    mocks.requestVideoRender.mockImplementation(async (_html: string, opts: { segment?: { offset: number; length: number } }) => {
      if (opts.segment && opts.segment.offset === 45) throw new Error("boom");
      return segResult(0);
    });
    await expect(
      renderSegments({ contractDuration: 65, documentHtml: DOC, sourceFileId: "src-4" }),
    ).rejects.toThrow(/Segment 2\/2.*t=45-65.*boom/);
  });

  const pinsOf = () =>
    mocks.requestVideoRender.mock.calls.map(
      (call) => (call[1] as { pinnedEncoder?: string }).pinnedEncoder,
    );

  it("pins every later segment to the first segment's encoder", async () => {
    await renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-pin-1",
    });

    // One output video = one set of H.264 parameters: the device picks on
    // the first segment, every later one must stay on that codec.
    expect(pinsOf()).toEqual([
      undefined,
      "c2.samsung.avc.encoder",
    ]);
    // The sidecar records the encoder so a later resume can re-pin.
    const sidecar = JSON.parse(
      mocks.files.get("/cache/render-src-pin-1@h264_mediacodec-unknown-yuv420p-seg-0-0-45.json")?.content ?? "{}",
    );
    expect(sidecar.encoder).toBe("c2.samsung.avc.encoder");
  });

  it("re-pins a resumed run from the cached segment's sidecar encoder", async () => {
    // Simulates resume after a process restart: the in-memory pin is gone,
    // but segment 0's sidecar remembers which codec made it.
    mocks.files.set("/cache/render-src-pin-2@h264_mediacodec-unknown-yuv420p-seg-0-0-45.mp4", {
      exists: true,
      content: "video",
    });
    mocks.files.set("/cache/render-src-pin-2@h264_mediacodec-unknown-yuv420p-seg-0-0-45.json", {
      exists: true,
      content: JSON.stringify({ hasAudio: false, encoder: "c2.android.avc.encoder" }),
    });

    await renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-pin-2",
    });

    expect(pinsOf()).toEqual([
      "c2.android.avc.encoder",
    ]);
    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(1);
  });

  it("re-renders a cached segment recorded under a different encoder", async () => {
    mocks.files.set("/cache/render-src-pin-3@h264_mediacodec-unknown-yuv420p-seg-0-0-45.mp4", { exists: true, content: "video" });
    mocks.files.set(
      "/cache/render-src-pin-3@h264_mediacodec-unknown-yuv420p-seg-0-0-45.json",
      { exists: true, content: JSON.stringify({ encoder: "c2.samsung.avc.encoder" }) },
    );
    mocks.files.set("/cache/render-src-pin-3@h264_mediacodec-unknown-yuv420p-seg-1-45-20.mp4", { exists: true, content: "video" });
    mocks.files.set(
      "/cache/render-src-pin-3@h264_mediacodec-unknown-yuv420p-seg-1-45-20.json",
      { exists: true, content: JSON.stringify({ encoder: "c2.android.avc.encoder" }) },
    );

    await renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-pin-3",
    });

    // Segment 0 sets the run's pin; segment 1 was made by another codec, so
    // it is dropped and re-rendered under the pin instead of poisoning concat.
    const offsets = mocks.requestVideoRender.mock.calls.map(
      (call) => (call[1] as { segment: { offset: number } }).segment.offset,
    );
    expect(offsets).toEqual([45]);
    expect(pinsOf()).toEqual([
      "c2.samsung.avc.encoder",
    ]);
    expect(mocks.concatSegments).toHaveBeenCalledTimes(1);
  });

  it("keeps a cached segment whose sidecar has no encoder record", async () => {
    // Pre-pin builds recorded no encoder: reuse the footage and let concat's
    // parameter check be the safety net (fail loud, never restart silently).
    mocks.files.set("/cache/render-src-pin-4@h264_mediacodec-unknown-yuv420p-seg-0-0-45.mp4", { exists: true, content: "video" });
    mocks.files.set("/cache/render-src-pin-4@h264_mediacodec-unknown-yuv420p-seg-0-0-45.json", {
      exists: true,
      content: JSON.stringify({ hasAudio: true }),
    });

    // 100 s = three segments: the pin takes effect on the one after first.
    await renderSegments({
      contractDuration: 100,
      documentHtml: DOC,
      sourceFileId: "src-pin-4",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    // No pin until a segment actually renders; then it takes effect.
    expect(pinsOf()).toEqual([undefined, "c2.samsung.avc.encoder"]);
  });

  it("keeps finished segments and never retries when concat rejects H.264 parameters", async () => {
    mocks.concatSegments.mockRejectedValueOnce(
      new Error(
        "Segment 3 was encoded with different H.264 parameters (SPS/PPS) than segment 1 (an encoder switch mid-run). Delete the render cache and re-run the export.",
      ),
    );

    const progress: number[] = [];
    await expect(renderSegments({
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-heal",
      onProgress: (p) => progress.push(p.bytesWritten / p.totalBytes * 100),
    })).rejects.toThrow(/Completed segments were kept.*did not restart automatically/);
    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    expect(mocks.concatSegments).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 2; i += 1) {
      const offset = i * 45;
      const length = Math.min(45, 65 - offset);
      expect(mocks.files.has(`/cache/render-src-heal@h264_mediacodec-unknown-yuv420p-seg-${i}-${offset}-${length}.mp4`)).toBe(true);
      expect(mocks.files.has(`/cache/render-src-heal@h264_mediacodec-unknown-yuv420p-seg-${i}-${offset}-${length}.json`)).toBe(true);
    }
    expect(Math.max(...progress)).toBe(99);
    expect(progress).not.toContain(100);

    // A USER-initiated retry can reuse every finished segment and only join.
    mocks.requestVideoRender.mockClear();
    await renderSegments({ contractDuration: 65, documentHtml: DOC, sourceFileId: "src-heal" });
    expect(mocks.requestVideoRender).not.toHaveBeenCalled();
    expect(mocks.concatSegments).toHaveBeenCalledTimes(2);
  });

  it("also keeps segments and fails without retry on a resolution mismatch", async () => {
    mocks.concatSegments.mockRejectedValueOnce(
      new Error(
        "Segment 2 resolution 1280x720 differs from segment 1 720x1280 (a stale render-cache file from a different scene size). Delete the render cache and re-run the export.",
      ),
    );

    await expect(renderSegments({ contractDuration: 65, documentHtml: DOC, sourceFileId: "src-heal-res" })).rejects.toThrow(/resolution/);
    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    expect(mocks.concatSegments).toHaveBeenCalledTimes(1);
    expect(mocks.files.has("/cache/render-src-heal-res@h264_mediacodec-unknown-yuv420p-seg-0-0-45.mp4")).toBe(true);
  });

  it("does not retry concat failures that are not cache mismatches", async () => {
    mocks.concatSegments.mockRejectedValueOnce(
      new Error("Need 1–32 segments to concatenate."),
    );

    await expect(
      renderSegments({ contractDuration: 65, documentHtml: DOC, sourceFileId: "src-noheal" }),
    ).rejects.toThrow(/Need 1–32/);

    expect(mocks.concatSegments).toHaveBeenCalledTimes(1);
    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
  });
});

describe("planShotSegments", () => {
  const shots = [
    { id: "a", start: 0, end: 10, hash: "ha" },
    { id: "b", start: 10, end: 20, hash: "hb" },
  ];

  it("cuts at shot edges so each segment carries its shot key", () => {
    expect(planShotSegments(20, shots)).toEqual([
      { offset: 0, length: 10, keys: ["a:ha"] },
      { offset: 10, length: 10, keys: ["b:hb"] },
    ]);
  });

  it("splits a shot longer than the 45 s page budget", () => {
    const segments = planShotSegments(100, [
      { id: "long", start: 0, end: 100, hash: "h" },
    ]);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(45);
      expect(segment.keys).toEqual(["long:h"]);
    }
    expect(segments[0].offset).toBe(0);
    expect(segments.at(-1)!.offset + segments.at(-1)!.length).toBe(100);
  });

  it("covers gaps with the base render and still cuts at shot edges", () => {
    const segments = planShotSegments(30, [
      { id: "middle", start: 10, end: 20, hash: "hm" },
    ]);
    expect(segments).toEqual([
      { offset: 0, length: 10, keys: [] },
      { offset: 10, length: 10, keys: ["middle:hm"] },
      { offset: 20, length: 10, keys: [] },
    ]);
  });

  it("splits a 5 s scene with two shots into two reusable segments", () => {
    expect(
      planShotSegments(5, [
        { id: "a", start: 0, end: 2.5, hash: "ha" },
        { id: "b", start: 2.5, end: 5, hash: "hb" },
      ]),
    ).toEqual([
      { offset: 0, length: 2.5, keys: ["a:ha"] },
      { offset: 2.5, length: 2.5, keys: ["b:hb"] },
    ]);
  });

  it("keeps a 5 s single-shot scene in one page render", () => {
    expect(
      planShotSegments(5, [{ id: "only", start: 0, end: 5, hash: "h" }]),
    ).toEqual([{ offset: 0, length: 5, keys: ["only:h"] }]);
  });

  it("never plans more than the segment budget", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `s${i}`,
      start: i,
      end: i + 1,
      hash: `h${i}`,
    }));
    expect(planShotSegments(120, many).length).toBeLessThanOrEqual(12);
  });
});

describe("planEditorClips", () => {
  it("makes one clip per shot plus one per gap, in timeline order", () => {
    expect(
      planEditorClips(30, [
        { id: "a", start: 5, end: 15, hash: "ha" },
        { id: "b", start: 20, end: 30, hash: "hb" },
      ]),
    ).toEqual([
      {
        id: "gap-1",
        label: "Gap 1",
        start: 0,
        end: 5,
        keys: [],
        segments: [{ offset: 0, length: 5, keys: [] }],
      },
      {
        id: "shot-a",
        label: "a",
        start: 5,
        end: 15,
        keys: ["a:ha"],
        shotId: "a",
        segments: [{ offset: 5, length: 10, keys: ["a:ha"] }],
      },
      {
        id: "gap-2",
        label: "Gap 2",
        start: 15,
        end: 20,
        keys: [],
        segments: [{ offset: 15, length: 5, keys: [] }],
      },
      {
        id: "shot-b",
        label: "b",
        start: 20,
        end: 30,
        keys: ["b:hb"],
        shotId: "b",
        segments: [{ offset: 20, length: 10, keys: ["b:hb"] }],
      },
    ]);
  });

  it("exports a flat scene as one full-video clip", () => {
    expect(planEditorClips(10, [])).toEqual([
      {
        id: "full",
        label: "Full video",
        start: 0,
        end: 10,
        keys: [],
        segments: [{ offset: 0, length: 10, keys: [] }],
      },
    ]);
  });

  it("splits a clip longer than the 45 s page budget into sub-segments", () => {
    const [clip] = planEditorClips(100, [
      { id: "long", start: 0, end: 100, hash: "h" },
    ]);
    expect(clip!.segments.length).toBe(3);
    for (const segment of clip!.segments) {
      expect(segment.length).toBeLessThanOrEqual(45);
      expect(segment.keys).toEqual(["long:h"]);
    }
    expect(clip!.segments[0]!.offset).toBe(0);
    expect(
      clip!.segments.at(-1)!.offset + clip!.segments.at(-1)!.length,
    ).toBe(100);
  });

  it("drops overlapping shots so editor clips never stack", () => {
    const clips = planEditorClips(20, [
      { id: "a", start: 0, end: 12, hash: "ha" },
      { id: "b", start: 6, end: 20, hash: "hb" },
    ]);
    expect(clips.map((clip) => clip.id)).toEqual(["shot-a", "gap-1"]);
    expect(clips[0]!.end).toBe(12);
    expect(clips[1]).toMatchObject({ start: 12, end: 20, keys: [] });
  });
});

describe("shot-aware incremental rendering", () => {
  const SHOT_DOC =
    '<script>window.MOBILE_AGENT_VIDEO = { duration: 20, fps: 30, shots: [{ id: "a", start: 0, end: 10, render: function () {} }, { id: "b", start: 10, end: 20, render: function () {} }], render: function () {} };</script>';

  const plan = (aHash: string, bHash: string, sharedHash = "h-shared") => ({
    duration: 20,
    fps: 30,
    width: 1280,
    height: 720,
    sharedHash,
    shots: [
      { id: "a", start: 0, end: 10, hash: aHash },
      { id: "b", start: 10, end: 20, hash: bHash },
    ],
  });

  const segmentFile = (offset: number, length: number, keys: string[]) =>
    `/cache/render-h-shared@h264_mediacodec-1280x720-30-yuv420p-${offset}-${length}-${hashSegmentKeys(keys)}.mp4`;

  it("re-encodes only the edited shot and reuses the other segment", async () => {
    mocks.probeVideoPlan.mockResolvedValue(plan("a1", "b1"));
    const first = await renderSegments({
      conversationId: "chat-shots",
      contractDuration: 20,
      documentHtml: SHOT_DOC,
      sourceFileId: "ignored",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    for (const [, options] of mocks.requestVideoRender.mock.calls) {
      expect(options.conversationId).toBe("chat-shots");
    }
    expect(mocks.concatSegments).toHaveBeenCalledTimes(1);
    expect(first.incremental).toEqual({
      shots: 2,
      renderedSegments: 2,
      reusedSegments: 0,
    });
    expect(first.duration).toBe(20);
    // Incremental footage is kept for the next revision (unlike legacy runs).
    expect(mocks.files.has(segmentFile(0, 10, ["a:a1"]))).toBe(true);
    expect(mocks.files.has(segmentFile(10, 10, ["b:b1"]))).toBe(true);

    mocks.requestVideoRender.mockClear();
    mocks.concatSegments.mockClear();
    mocks.probeVideoPlan.mockResolvedValue(plan("a1", "b2"));
    const second = await renderSegments({
      contractDuration: 20,
      documentHtml: SHOT_DOC,
      sourceFileId: "ignored",
    });

    // Only shot B's segment was encoded; A's cached footage joined it.
    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(1);
    expect(
      (mocks.requestVideoRender.mock.calls[0][1] as { segment: { offset: number } })
        .segment.offset,
    ).toBe(10);
    expect(second.incremental).toEqual({
      shots: 2,
      renderedSegments: 1,
      reusedSegments: 1,
    });
    expect(mocks.files.has(segmentFile(0, 10, ["a:a1"]))).toBe(true);
    expect(mocks.files.has(segmentFile(10, 10, ["b:b2"]))).toBe(true);
    // The superseded shot-B footage was pruned.
    expect(mocks.files.has(segmentFile(10, 10, ["b:b1"]))).toBe(false);
  });

  it("invalidates every segment when shared scene code changes", async () => {
    mocks.probeVideoPlan.mockResolvedValue(plan("a1", "b1"));
    await renderSegments({
      contractDuration: 20,
      documentHtml: SHOT_DOC,
      sourceFileId: "ignored",
    });

    mocks.requestVideoRender.mockClear();
    mocks.probeVideoPlan.mockResolvedValue(plan("a1", "b1", "h-shared-2"));
    await renderSegments({
      contractDuration: 20,
      documentHtml: SHOT_DOC,
      sourceFileId: "ignored",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
  });

  it("falls back to the legacy path when the probe fails", async () => {
    mocks.probeVideoPlan.mockRejectedValue(new Error("probe failed"));
    const out = await renderSegments({
      contractDuration: 20,
      documentHtml: SHOT_DOC,
      sourceFileId: "src-fallback",
    });

    expect(out.incremental).toBeUndefined();
    expect(mocks.requestVideoRender).toHaveBeenCalledWith(
      SHOT_DOC,
      expect.objectContaining({ segment: undefined }),
    );
  });

  it("does not probe legacy documents", async () => {
    await renderSegments({
      contractDuration: 20,
      documentHtml: DOC,
      sourceFileId: "src-legacy",
    });
    expect(mocks.probeVideoPlan).not.toHaveBeenCalled();
  });
});

describe("editor package rendering", () => {
  const EDITOR_DOC =
    '<script>window.MOBILE_AGENT_VIDEO = { duration: 20, fps: 30, width: 1280, height: 720, shots: [{ id: "a", start: 0, end: 10, render: function () {} }, { id: "b", start: 10, end: 20, render: function () {} }], render: function () {} };</script>';

  const plan = {
    duration: 20,
    fps: 30,
    width: 1280,
    height: 720,
    sharedHash: "edit-shared",
    shots: [
      { id: "a", start: 0, end: 10, hash: "a1" },
      { id: "b", start: 10, end: 20, hash: "b1" },
    ],
  };

  // Editor exports go through the backend seam, so the cache namespace now
  // carries the encoder profile. With no backend supplied the device runs.
  const editorProfile = profileIdFor({
    encoder: "h264_mediacodec",
    width: 1280,
    height: 720,
    fps: 30,
  });

  const editorSegmentFile = (offset: number, length: number, keys: string[]) =>
    `/cache/render-ed-edit-shared@${editorProfile}-ed-${offset}-${length}-${hashSegmentKeys(keys)}.mp4`;

  it("renders one clip per shot and joins the full video separately", async () => {
    mocks.probeVideoPlan.mockResolvedValue(plan);
    const out = await renderSegments({
      conversationId: "chat-editor",
      contractDuration: 20,
      documentHtml: EDITOR_DOC,
      editorClips: true,
      sourceFileId: "ignored",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
    for (const [, options] of mocks.requestVideoRender.mock.calls) {
      expect(options.conversationId).toBe("chat-editor");
    }

    // Two clips and the finished timeline each get their own join.
    expect(mocks.concatSegments).toHaveBeenCalledTimes(3);
    const destinations = mocks.concatSegments.mock.calls.map(
      (call) => call[1] as string,
    );
    expect(destinations[0]).toContain("/01-a.mp4");
    expect(destinations[1]).toContain("/02-b.mp4");
    expect(destinations[2]).toContain("/full.mp4");

    expect(out.clips?.map((clip) => clip.fileName)).toEqual([
      "01-a.mp4",
      "02-b.mp4",
    ]);
    expect(out.clips?.[0]).toMatchObject({
      label: "a",
      shotId: "a",
      start: 0,
      end: 10,
      duration: 10,
    });
    expect(out.editorPackage).toMatchObject({
      fps: 30,
      width: 1280,
      height: 720,
    });
    expect(out.editorPackage?.directoryUri).toContain("/editor-ed-edit-shared@");
    expect(out.duration).toBe(20);
    expect(out.uri).toContain("/full.mp4");
    expect(out.incremental).toEqual({
      shots: 2,
      renderedSegments: 2,
      reusedSegments: 0,
    });

    // Editor segments live in their own namespace so pruning one mode cannot
    // delete footage the other is resuming.
    expect(mocks.files.has(editorSegmentFile(0, 10, ["a:a1"]))).toBe(true);
    expect(mocks.files.has(editorSegmentFile(10, 10, ["b:b1"]))).toBe(true);
  });

  it("reuses every cached editor segment on an unchanged re-export", async () => {
    mocks.probeVideoPlan.mockResolvedValue(plan);
    await renderSegments({
      contractDuration: 20,
      documentHtml: EDITOR_DOC,
      editorClips: true,
      sourceFileId: "ignored",
    });

    mocks.requestVideoRender.mockClear();
    mocks.concatSegments.mockClear();
    const second = await renderSegments({
      contractDuration: 20,
      documentHtml: EDITOR_DOC,
      editorClips: true,
      sourceFileId: "ignored",
    });

    expect(mocks.requestVideoRender).not.toHaveBeenCalled();
    expect(mocks.concatSegments).toHaveBeenCalledTimes(3);
    expect(second.incremental).toEqual({
      shots: 2,
      renderedSegments: 0,
      reusedSegments: 2,
    });
  });

  it("falls back to a single full-video clip when the probe fails", async () => {
    mocks.probeVideoPlan.mockRejectedValue(new Error("probe failed"));
    const out = await renderSegments({
      contractDuration: 20,
      documentHtml: EDITOR_DOC,
      editorClips: true,
      sourceFileId: "ignored",
    });

    expect(out.clips).toHaveLength(1);
    expect(out.clips?.[0]).toMatchObject({ label: "Full video", start: 0, end: 20 });
    expect(out.clips?.[0]?.fileName).toBe("01-full-video.mp4");
    expect(out.editorPackage).toMatchObject({
      fps: 30,
      width: 1280,
      height: 720,
    });
    expect(mocks.concatSegments).toHaveBeenCalledTimes(2);
  });

  it("fails with a duration hint when no length is known", async () => {
    mocks.probeVideoPlan.mockRejectedValue(new Error("probe failed"));
    await expect(
      renderSegments({
        contractDuration: null,
        documentHtml: "<html>MOBILE_AGENT_VIDEO</html>",
        editorClips: true,
        sourceFileId: "ignored",
      }),
    ).rejects.toThrow(/duration is unknown/);
  });

  it("ignores zeroed probe metadata and falls back to the contract", async () => {
    mocks.probeVideoPlan.mockResolvedValue({
      duration: 0,
      fps: 0,
      width: 0,
      height: 0,
      sharedHash: "",
      shots: [],
    });

    const out = await renderSegments({
      contractDuration: 20,
      documentHtml: EDITOR_DOC,
      editorClips: true,
      sourceFileId: "ignored",
    });

    expect(out.duration).toBe(20);
    expect(out.editorPackage).toMatchObject({
      fps: 30,
      width: 1280,
      height: 720,
    });
    expect(out.clips).toHaveLength(1);
  });
});

describe("renderSegments backend seam", () => {
  function fakeBackend(overrides: Partial<RenderBackend> = {}) {
    const requests: SegmentRequest[] = [];
    const concats: { uris: string[]; outUri: string }[] = [];
    const backend: RenderBackend = {
      id: "test-remote",
      label: "Test remote",
      kind: "remote",
      concurrency: 1,
      supportsProbe: true,
      profileFor: (plan) => ({
        id: profileIdFor({
          encoder: "h264_nvenc",
          width: plan?.width ?? 0,
          height: plan?.height ?? 0,
          fps: plan?.fps ?? 0,
        }),
        width: plan?.width ?? 0,
        height: plan?.height ?? 0,
        fps: plan?.fps ?? 0,
        codec: "h264",
        pixelFormat: "yuv420p",
        bitrateKbps: 8000,
        encoder: "h264_nvenc",
        hardware: true,
      }),
      probe: vi.fn(),
      renderSegment: async (request) => {
        requests.push(request);
        const index = request.segment ? Math.round(request.segment.offset / 45) : 0;
        request.onProgress?.(1);
        return {
          uri: `file:///cache/remote-seg-${index}.mp4`,
          encoder: "h264_nvenc",
          hasAudio: true,
          audioWarnings: [],
        };
      },
      concat: async (uris, outUri) => {
        concats.push({ uris, outUri });
      },
      ...overrides,
    };
    return { backend, requests, concats };
  }

  it("routes every segment and the concat through a supplied backend", async () => {
    const { backend, requests, concats } = fakeBackend();

    const out = await renderSegments({
      backend,
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-remote",
    });

    // The device pipeline must be fully bypassed.
    expect(mocks.requestVideoRender).not.toHaveBeenCalled();
    expect(mocks.concatSegments).not.toHaveBeenCalled();

    expect(requests.map((request) => request.segment)).toEqual([
      { offset: 0, length: 45 },
      { offset: 45, length: 20 },
    ]);
    expect(requests.every((request) => request.documentHtml === DOC)).toBe(true);
    expect(requests.every((request) => request.duration === 65)).toBe(true);

    expect(concats).toHaveLength(1);
    expect(concats[0].outUri).toMatch(
      /render-src-remote@h264_nvenc-unknown-yuv420p-full\.mp4$/,
    );
    expect(out.uri).toBe(concats[0].outUri);
    expect(out.encoder).toBe("h264_nvenc");
    expect(out.warnings.join(" ")).toMatch(/2 segments/);
  });

  it("keeps the on-device backend when none is supplied", async () => {
    const out = await renderSegments({
      contractDuration: 20,
      documentHtml: DOC,
      sourceFileId: "src-default",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(1);
    expect(out.encoder).toBe("c2.samsung.avc.encoder");
  });

  it("skips the plan probe when the backend cannot probe", async () => {
    const { backend } = fakeBackend({ supportsProbe: false });
    const shotDoc =
      '<script>window.MOBILE_AGENT_VIDEO = { duration: 20, fps: 30, shots: [{ id: "a", start: 0, end: 10, render: function () {} }], render: function () {} };</script>';

    const out = await renderSegments({
      backend,
      contractDuration: 20,
      documentHtml: shotDoc,
      sourceFileId: "src-no-probe",
    });

    expect(backend.probe).not.toHaveBeenCalled();
    expect(out.incremental).toBeUndefined();
  });
});

describe("renderSegments profile isolation", () => {
  const SEAM_SHOT_DOC =
    '<script>window.MOBILE_AGENT_VIDEO = { duration: 20, fps: 30, shots: [{ id: "a", start: 0, end: 10, render: function () {} }, { id: "b", start: 10, end: 20, render: function () {} }], render: function () {} };</script>';

  const shotPlan = () => ({
    duration: 20,
    fps: 30,
    width: 1280,
    height: 720,
    sharedHash: "h-shared",
    shots: [
      { id: "a", start: 0, end: 10, hash: "a1" },
      { id: "b", start: 10, end: 20, hash: "b1" },
    ],
  });

  function backendWith(encoder: string) {
    const requests: SegmentRequest[] = [];
    const backend: RenderBackend = {
      id: `test-${encoder}`,
      label: encoder,
      kind: "remote",
      concurrency: 1,
      supportsProbe: true,
      profileFor: (plan) => ({
        id: profileIdFor({
          encoder,
          width: plan?.width ?? 0,
          height: plan?.height ?? 0,
          fps: plan?.fps ?? 0,
        }),
        width: plan?.width ?? 0,
        height: plan?.height ?? 0,
        fps: plan?.fps ?? 0,
        codec: "h264",
        pixelFormat: "yuv420p",
        bitrateKbps: 8000,
        encoder,
        hardware: true,
      }),
      probe: async () => shotPlan(),
      renderSegment: async (request) => {
        requests.push(request);
        request.onProgress?.(1);
        return {
          uri: `file:///cache/out-${requests.length}.mp4`,
          encoder,
          hasAudio: true,
          audioWarnings: [],
        };
      },
      concat: async () => {},
    };
    return { backend, requests };
  }

  it("names segment files and sidecars after the encoder profile", async () => {
    mocks.probeVideoPlan.mockResolvedValue(shotPlan());
    const { backend } = backendWith("h264_nvenc");

    await renderSegments({
      backend,
      contractDuration: 20,
      documentHtml: SEAM_SHOT_DOC,
      sourceFileId: "ignored",
    });

    const stem = `/cache/render-h-shared@h264_nvenc-1280x720-30-yuv420p-0-10-${hashSegmentKeys(["a:a1"])}`;
    expect(mocks.files.has(`${stem}.mp4`)).toBe(true);
    const sidecar = JSON.parse(mocks.files.get(`${stem}.json`)?.content ?? "{}");
    expect(sidecar).toMatchObject({
      profile: "h264_nvenc-1280x720-30-yuv420p",
      origin: "remote",
      encoder: "h264_nvenc",
    });
  });

  it("never reuses footage recorded under another profile", async () => {
    const gpu = backendWith("h264_nvenc");
    const cpu = backendWith("libx264");

    mocks.probeVideoPlan.mockResolvedValue(shotPlan());
    await renderSegments({
      backend: gpu.backend,
      contractDuration: 20,
      documentHtml: SEAM_SHOT_DOC,
      sourceFileId: "ignored",
    });
    expect(gpu.requests).toHaveLength(2);

    // Same scene, same shared hash, different encoder: the GPU footage is not
    // joinable (SPS/PPS), so every segment must be encoded again.
    mocks.probeVideoPlan.mockResolvedValue(shotPlan());
    const out = await renderSegments({
      backend: cpu.backend,
      contractDuration: 20,
      documentHtml: SEAM_SHOT_DOC,
      sourceFileId: "ignored",
    });

    expect(cpu.requests).toHaveLength(2);
    expect(out.incremental).toEqual({
      shots: 2,
      renderedSegments: 2,
      reusedSegments: 0,
    });
    // The other profile's footage is kept: switching back stays instant.
    expect(
      mocks.files.has(
        `/cache/render-h-shared@h264_nvenc-1280x720-30-yuv420p-0-10-${hashSegmentKeys(["a:a1"])}.mp4`,
      ),
    ).toBe(true);
  });

  it("treats a sidecar from another profile as a cache miss", async () => {
    mocks.probeVideoPlan.mockResolvedValue(shotPlan());
    const { backend, requests } = backendWith("h264_nvenc");
    const stem = `/cache/render-h-shared@h264_nvenc-1280x720-30-yuv420p-0-10-${hashSegmentKeys(["a:a1"])}`;
    mocks.files.set(`${stem}.mp4`, { exists: true, content: "video" });
    mocks.files.set(`${stem}.json`, {
      exists: true,
      content: JSON.stringify({ profile: "libx264-1280x720-30-yuv420p", encoder: "libx264" }),
    });

    const out = await renderSegments({
      backend,
      contractDuration: 20,
      documentHtml: SEAM_SHOT_DOC,
      sourceFileId: "ignored",
    });

    // Segment A re-encoded instead of being adopted from the stale sidecar.
    expect(requests.map((request) => request.segment?.offset)).toEqual([0, 10]);
    expect(out.incremental?.reusedSegments).toBe(0);
  });
});

describe("renderSegments concurrency", () => {
  const POOL_DOC =
    '<script>window.MOBILE_AGENT_VIDEO = { duration: 30, fps: 30, shots: [1], render: function () {} };</script>';

  const planFor = (shots: number, duration = 30) => ({
    duration,
    fps: 30,
    width: 1280,
    height: 720,
    sharedHash: "h-pool",
    shots: Array.from({ length: shots }, (_, i) => ({
      id: `s${i}`,
      start: (duration / shots) * i,
      end: (duration / shots) * (i + 1),
      hash: `h${i}`,
    })),
  });

  function poolBackend(options: {
    concurrency: number;
    plan: ReturnType<typeof planFor>;
    renderSegment: (request: SegmentRequest) => Promise<SegmentArtifact>;
  }) {
    const concats: string[][] = [];
    const backend: RenderBackend = {
      id: "test-pool",
      label: "pool",
      kind: "remote",
      concurrency: options.concurrency,
      supportsProbe: true,
      profileFor: (plan) => ({
        id: profileIdFor({
          encoder: "h264_nvenc",
          width: plan?.width ?? 0,
          height: plan?.height ?? 0,
          fps: plan?.fps ?? 0,
        }),
        width: plan?.width ?? 0,
        height: plan?.height ?? 0,
        fps: plan?.fps ?? 0,
        codec: "h264",
        pixelFormat: "yuv420p",
        bitrateKbps: 8000,
        encoder: "h264_nvenc",
        hardware: true,
      }),
      probe: async () => options.plan,
      renderSegment: options.renderSegment,
      concat: async (uris) => {
        concats.push(uris);
      },
    };
    return { backend, concats };
  }

  const artifactFor = (offset: number): SegmentArtifact => ({
    uri: `file:///cache/pool-${offset}.mp4`,
    encoder: "h264_nvenc",
    hasAudio: true,
    audioWarnings: [],
  });

  it("never runs more segments at once than the backend allows", async () => {
    let inFlight = 0;
    let peak = 0;
    const { backend } = poolBackend({
      concurrency: 3,
      plan: planFor(6),
      renderSegment: async (request) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return artifactFor(request.segment?.offset ?? 0);
      },
    });

    const out = await renderSegments({
      backend,
      contractDuration: 30,
      documentHtml: POOL_DOC,
      sourceFileId: "ignored",
    });

    expect(peak).toBe(3);
    expect(out.incremental).toEqual({
      shots: 6,
      renderedSegments: 6,
      reusedSegments: 0,
    });
  });

  it("concatenates in timeline order even when segments finish out of order", async () => {
    const gates = new Map<number, () => void>();
    const { backend, concats } = poolBackend({
      concurrency: 6,
      plan: planFor(6),
      renderSegment: (request) =>
        new Promise<SegmentArtifact>((resolve) => {
          gates.set(request.segment?.offset ?? 0, () =>
            resolve(artifactFor(request.segment?.offset ?? 0)),
          );
        }),
    });

    const run = renderSegments({
      backend,
      contractDuration: 30,
      documentHtml: POOL_DOC,
      sourceFileId: "ignored",
    });

    // Wait until every segment is in flight, then release them in reverse.
    for (let i = 0; i < 100 && gates.size < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(gates.size).toBe(6);
    for (const offset of [...gates.keys()].sort((a, b) => b - a)) {
      gates.get(offset)?.();
    }

    await run;

    expect(concats).toHaveLength(1);
    expect(concats[0]).toEqual(
      [0, 5, 10, 15, 20, 25].map(
        (offset) =>
          `file:///cache/render-h-pool@h264_nvenc-1280x720-30-yuv420p-${offset}-5-${hashSegmentKeys([
            `s${offset / 5}:h${offset / 5}`,
          ])}.mp4`,
      ),
    );
  });

  it("keeps finished footage when a pooled segment fails", async () => {
    const { backend, concats } = poolBackend({
      concurrency: 3,
      plan: planFor(3),
      renderSegment: async (request) => {
        const offset = request.segment?.offset ?? 0;
        if (offset === 10) throw new Error("GPU lost");
        return artifactFor(offset);
      },
    });

    await expect(
      renderSegments({
        backend,
        contractDuration: 30,
        documentHtml: POOL_DOC,
        sourceFileId: "ignored",
      }),
    ).rejects.toThrow(/Segment 2\/3 .*GPU lost/);

    const cachedNames = [...mocks.files.keys()].filter((name) => name.includes("render-h-pool@"));
    // Segments 0 and 2 landed; segment 1 did not, and nothing was joined.
    expect(cachedNames.some((name) => name.includes("-0-10-"))).toBe(true);
    expect(cachedNames.some((name) => name.includes("-20-10-"))).toBe(true);
    expect(cachedNames.some((name) => name.includes("-10-10-"))).toBe(false);
    expect(concats).toHaveLength(0);
  });

  it("reports progress monotonically with a pool", async () => {
    const seen: number[] = [];
    const { backend } = poolBackend({
      concurrency: 3,
      plan: planFor(6),
      renderSegment: async (request) => {
        request.onProgress?.(0.5);
        request.onProgress?.(1);
        return artifactFor(request.segment?.offset ?? 0);
      },
    });

    await renderSegments({
      backend,
      contractDuration: 30,
      documentHtml: POOL_DOC,
      sourceFileId: "ignored",
      onProgress: (progress) => seen.push(progress.bytesWritten),
    });

    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(10000);
  });
});
