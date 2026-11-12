import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolExecutionRecord } from "@/core/types/app-state";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  resolveWorkspaceFile: vi.fn(),
  readTextFile: vi.fn(),
  requestMixCheck: vi.fn(),
  onRecord: vi.fn(),
}));

// The real mix host is a mounted WebView; the queue has its own tests.
vi.mock("@/modules/preview/video-mix", () => ({
  requestMixCheck: mocks.requestMixCheck,
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({
    readTextFile: mocks.readTextFile,
  }),
  resolveWorkspaceFile: mocks.resolveWorkspaceFile,
}));

// render-video.ts imports expo-file-system (File) at module load; it is not
// loadable here and the mix tool never touches it.
vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));

const { buildMixWarning, createPreviewMixTool, formatMixPreview } = await import(
  "@/modules/tools/built-in/preview-mix"
);

const SCENE_6S =
  '<html><body><canvas id="c"></canvas><script>window.MOBILE_AGENT_VIDEO = { duration: 6, fps: 30, canvasId: "c", render: function () {} };</script></body></html>';

const HEALTHY = {
  peak: 0.7,
  rms: 0.3,
  clipped: false,
  clippedRanges: [],
  quietRanges: [],
  duckedRanges: [],
  duration: 6,
};

function repository(records: Record<string, object> = {}) {
  mocks.getById.mockImplementation(async (id: string) => records[id] ?? null);
  return { getById: mocks.getById } as never;
}

function audioFile() {
  mocks.resolveWorkspaceFile.mockReturnValue({
    exists: true,
    bytes: async () => new Uint8Array([1, 2, 3, 4]),
  });
}

function makeTool() {
  mocks.requestMixCheck.mockResolvedValue({ stats: HEALTHY, warnings: [] });
  return createPreviewMixTool({
    repository: repository(),
    onRecord: mocks.onRecord,
  });
}

async function execute(tool: ReturnType<typeof makeTool>, input: object) {
  const def = tool as unknown as {
    execute: (input: object, opts: object) => Promise<unknown>;
  };
  return def.execute(input, {});
}

describe("buildMixWarning", () => {
  it("returns null for a healthy mix", () => {
    expect(buildMixWarning(HEALTHY, [])).toBeNull();
  });

  it("names clipping spots with a fix", () => {
    const warning = buildMixWarning(
      {
        ...HEALTHY,
        peak: 1.2,
        clipped: true,
        clippedRanges: [
          { start: 12.4, end: 12.9 },
          { start: 31, end: 31.2 },
        ],
      },
      [],
    );
    expect(warning).toMatch(/clips at 12.4s–12.9s, 31s–31.2s/);
    expect(warning).toMatch(/music to ~0.35/);
  });

  it("flags near-silence", () => {
    expect(
      buildMixWarning({ ...HEALTHY, peak: 0.01, rms: 0.008 }, []),
    ).toMatch(/Almost no audible audio/);
  });

  it("passes through host warnings when there are no stats", () => {
    expect(buildMixWarning(null, ["no schedule"])).toBe("no schedule");
    expect(buildMixWarning(null, [])).toBeNull();
  });
});

describe("formatMixPreview", () => {
  it("summarises levels and keeps the actionable warning", () => {
    expect(
      formatMixPreview({
        clipped: true,
        duration: 6,
        peak: 1.2,
        rms: 0.4,
        warning: "Lower the music.",
      }),
    ).toBe(
      "Duration: 6s\nPeak: 1.2\nRMS: 0.4\nClipping: yes\n\nLower the music.",
    );
  });

  it("says the mix is clean when there is no warning", () => {
    expect(
      formatMixPreview({
        clipped: false,
        duration: 6,
        peak: 0.7,
        rms: 0.3,
        warning: null,
      }),
    ).toContain("No clipping detected.");
  });
});

describe("previewMix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rounded numbers with a null warning for a healthy mix", async () => {
    const out = (await execute(makeTool(), { html: SCENE_6S, duration: 6 })) as {
      peak: number;
      warning: null;
    };

    expect(mocks.requestMixCheck).toHaveBeenCalledWith(
      expect.stringContaining("MOBILE_AGENT_VIDEO"),
      expect.objectContaining({ duration: 6 }),
    );
    expect(out).toMatchObject({ peak: 0.7, rms: 0.3, clipped: false });
    expect(out.warning).toBeNull();
    expect(mocks.onRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "previewMix",
        status: "completed",
        preview: expect.objectContaining({
          title: "audio mix",
          text: expect.stringContaining("Peak: 0.7"),
        }),
      }),
    );
  });

  it("inlines file audio so tracks can decode", async () => {
    const tool = createPreviewMixTool({
      repository: repository({
        "audio-1": {
          id: "audio-1",
          displayName: "song.mp3",
          mimeType: "audio/mpeg",
          relativePath: "audio-1/song.mp3",
        },
      }),
      onRecord: () => {},
    });
    audioFile();
    mocks.requestMixCheck.mockResolvedValue({
      stats: HEALTHY,
      warnings: [],
    });

    const html = SCENE_6S.replace(
      "render: function () {}",
      "render: function () {}, audio: { tracks: [{ file: \"workspace://audio-1\" }] }",
    );
    await execute(tool, { html, duration: 6 });

    const doc = mocks.requestMixCheck.mock.calls[0][0] as string;
    expect(doc).not.toContain("workspace://audio-1");
    expect(doc).toContain("data:audio/mpeg;base64,");
  });

  it("surfaces host warnings with null stats instead of throwing", async () => {
    const tool = makeTool();
    mocks.requestMixCheck.mockResolvedValue({
      stats: null,
      warnings: ["The scene has no audio schedule to check."],
    });
    const out = (await execute(tool, { html: SCENE_6S, duration: 6 })) as {
      peak: null;
      warning: string;
    };

    expect(out.peak).toBeNull();
    expect(out.warning).toMatch(/no audio schedule/);
    expect(mocks.onRecord).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "previewMix", status: "completed" }),
    );
  });

  it("fails fast on a duration mismatch", async () => {
    await expect(
      execute(makeTool(), { html: SCENE_6S, duration: 20 }),
    ).rejects.toThrow(/does not match/);
    expect(mocks.requestMixCheck).not.toHaveBeenCalled();
  });

  it("records a failure when the host throws", async () => {
    const records: ToolExecutionRecord[] = [];
    mocks.onRecord.mockImplementation((record: ToolExecutionRecord) =>
      records.push(record),
    );
    mocks.requestMixCheck.mockRejectedValue(new Error("offline exploded"));

    const tool = createPreviewMixTool({
      repository: repository(),
      onRecord: mocks.onRecord,
    });
    await expect(execute(tool, { html: SCENE_6S, duration: 6 })).rejects.toThrow(
      /exploded/,
    );
    expect(records.at(-1)).toMatchObject({
      toolName: "previewMix",
      status: "failed",
    });
  });
});
