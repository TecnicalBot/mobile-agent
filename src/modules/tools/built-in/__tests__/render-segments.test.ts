import { beforeEach, describe, expect, it, vi } from "vitest";

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
const { hashSegmentKeys, planShotSegments } = await import(
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
      contractDuration: 20,
      documentHtml: DOC,
      sourceFileId: "src-1",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(1);
    expect(mocks.requestVideoRender).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({ segment: undefined }),
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
      contractDuration: 65,
      documentHtml: DOC,
      sourceFileId: "src-2",
      onProgress: (p) => progress.push(p.bytesWritten / p.totalBytes * 100),
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
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
    mocks.files.set("/cache/render-src-3-seg-0-0-45.mp4", { exists: true, content: "video" });
    mocks.files.set(
      "/cache/render-src-3-seg-0-0-45.json",
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
    mocks.files.set("/cache/render-src-layout-seg-0-0-30.mp4", { exists: true, content: "video" });
    mocks.files.set("/cache/render-src-layout-seg-0-0-30.json", {
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
      mocks.files.get("/cache/render-src-pin-1-seg-0-0-45.json")?.content ?? "{}",
    );
    expect(sidecar.encoder).toBe("c2.samsung.avc.encoder");
  });

  it("re-pins a resumed run from the cached segment's sidecar encoder", async () => {
    // Simulates resume after a process restart: the in-memory pin is gone,
    // but segment 0's sidecar remembers which codec made it.
    mocks.files.set("/cache/render-src-pin-2-seg-0-0-45.mp4", {
      exists: true,
      content: "video",
    });
    mocks.files.set("/cache/render-src-pin-2-seg-0-0-45.json", {
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
    mocks.files.set("/cache/render-src-pin-3-seg-0-0-45.mp4", { exists: true, content: "video" });
    mocks.files.set(
      "/cache/render-src-pin-3-seg-0-0-45.json",
      { exists: true, content: JSON.stringify({ encoder: "c2.samsung.avc.encoder" }) },
    );
    mocks.files.set("/cache/render-src-pin-3-seg-1-45-20.mp4", { exists: true, content: "video" });
    mocks.files.set(
      "/cache/render-src-pin-3-seg-1-45-20.json",
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
    mocks.files.set("/cache/render-src-pin-4-seg-0-0-45.mp4", { exists: true, content: "video" });
    mocks.files.set("/cache/render-src-pin-4-seg-0-0-45.json", {
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
      expect(mocks.files.has(`/cache/render-src-heal-seg-${i}-${offset}-${length}.mp4`)).toBe(true);
      expect(mocks.files.has(`/cache/render-src-heal-seg-${i}-${offset}-${length}.json`)).toBe(true);
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
    expect(mocks.files.has("/cache/render-src-heal-res-seg-0-0-45.mp4")).toBe(true);
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
    `/cache/render-h-shared-${offset}-${length}-${hashSegmentKeys(keys)}.mp4`;

  it("re-encodes only the edited shot and reuses the other segment", async () => {
    mocks.probeVideoPlan.mockResolvedValue(plan("a1", "b1"));
    const first = await renderSegments({
      contractDuration: 20,
      documentHtml: SHOT_DOC,
      sourceFileId: "ignored",
    });

    expect(mocks.requestVideoRender).toHaveBeenCalledTimes(2);
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
