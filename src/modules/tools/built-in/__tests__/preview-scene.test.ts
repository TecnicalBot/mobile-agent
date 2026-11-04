import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolExecutionRecord } from "@/core/types/app-state";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  resolveWorkspaceFile: vi.fn(),
  createDocumentFile: vi.fn(),
  readTextFile: vi.fn(),
  requestScenePreview: vi.fn(),
  onRecord: vi.fn(),
  createContactSheet: vi.fn(),
}));
vi.mock("@/modules/preview/contact-sheet", () => ({
  MAX_CONTACT_SHEET_FRAMES: 12,
  createContactSheet: mocks.createContactSheet,
}));

// The real preview host is a mounted WebView; the queue has its own tests.
vi.mock("@/modules/preview/video-preview", () => ({
  requestScenePreview: mocks.requestScenePreview,
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({
    createDocumentFile: mocks.createDocumentFile,
    readTextFile: mocks.readTextFile,
  }),
  resolveWorkspaceFile: mocks.resolveWorkspaceFile,
}));

// render-video.ts imports expo-file-system (File) at module load; it is not
// loadable here and the preview tool never touches it.
vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));

const {
  createPreviewSceneTool,
  defaultStoryboardTimes,
  normalizePreviewTimes,
} = await import("@/modules/tools/built-in/preview-scene");

const SCENE_6S =
  '<html><body><canvas id="c"></canvas><script>window.MOBILE_AGENT_VIDEO = { duration: 6, fps: 30, canvasId: "c", render: function () {} };</script></body></html>';

function repository(records: Record<string, object> = {}) {
  mocks.getById.mockImplementation(async (id: string) => records[id] ?? null);
  return { getById: mocks.getById } as never;
}

function jpegFile(displayName: string, mimeType: string) {
  mocks.resolveWorkspaceFile.mockReturnValue({
    exists: true,
    bytes: async () => new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  });
  return { displayName, mimeType };
}

function makeTool(supportsImageInput = true) {
  mocks.createContactSheet.mockResolvedValue({ time: 0, width: 960, height: 536, base64: "QUJD" });
  mocks.resolveWorkspaceFile.mockReturnValue({ uri: "file:///workspace/frame.jpg" });
  mocks.requestScenePreview.mockImplementation(
    async (_html: string, options: { times: number[] }) => ({
      frames: options.times.map((time) => ({
        time,
        width: 1280,
        height: 720,
        base64: "QUJD",
      })),
      warnings: [],
    }),
  );
  mocks.createDocumentFile.mockImplementation(
    async ({ name }: { name: string }) => ({ id: `still-${name}`, displayName: name, relativePath: name }),
  );
  return createPreviewSceneTool({
    repository: repository(),
    onRecord: mocks.onRecord,
    supportsImageInput,
  });
}

async function execute(tool: ReturnType<typeof makeTool>, input: object) {
  const def = tool as unknown as {
    execute: (input: object, opts: object) => Promise<unknown>;
  };
  return def.execute(input, {});
}

describe("defaultStoryboardTimes", () => {
  it("covers start, quarters, and just before the end", () => {
    expect(defaultStoryboardTimes(10)).toEqual([0, 2.5, 5, 7.5, 9.95]);
    expect(defaultStoryboardTimes(1)).toEqual([0, 0.25, 0.5, 0.75, 0.95]);
  });
});

describe("normalizePreviewTimes", () => {
  it("sorts, dedupes, and clamps with warnings", () => {
    expect(normalizePreviewTimes([4, 1, 1, 99], 4, [0])).toEqual({
      times: [1, 4],
      warnings: [expect.stringContaining("clamped")],
    });
  });

  it("caps the frame count", () => {
    const { times, warnings } = normalizePreviewTimes(
      Array.from({ length: 13 }, (_, i) => i),
      20,
      [0],
    );
    expect(times).toHaveLength(12);
    expect(warnings).toEqual([expect.stringContaining("first 12")]);
  });

  it("falls back to the opening frame for garbage input", () => {
    expect(normalizePreviewTimes([NaN], 4, [0])).toEqual({
      times: [0],
      warnings: [expect.stringContaining("No valid")],
    });
  });
});

describe("previewScene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("storyboards by default and returns inline vision frames", async () => {
    const out = (await execute(makeTool(), { html: SCENE_6S, duration: 6 })) as {
      content: unknown[];
      frames: { fileId: string; link: string; time: number }[];
      frameCount: number;
      warnings: unknown[];
    };

    expect(mocks.requestScenePreview).toHaveBeenCalledWith(
      expect.stringContaining("MOBILE_AGENT_VIDEO"),
      expect.objectContaining({ times: [0, 1.5, 3, 4.5, 5.95] }),
    );
    expect(mocks.createDocumentFile).toHaveBeenCalledTimes(1);
    expect(mocks.createContactSheet).toHaveBeenCalledOnce();
    expect(out.frameCount).toBe(5);
    expect(out.frames[0]).toMatchObject({ times: [0, 1.5, 3, 4.5, 5.95] });
    expect(out.content).toHaveLength(2);
    expect(mocks.onRecord).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "previewScene", status: "completed" }),
    );
  });

  it("inlines images and clips but leaves audio tracks alone", async () => {
    const tool = createPreviewSceneTool({
      repository: repository({
        "img-1": jpegFile("photo.jpg", "image/jpeg"),
        "vid-1": { displayName: "clip.mp4", mimeType: "video/mp4" },
      }),
      onRecord: () => {},
    });
    mocks.requestScenePreview.mockResolvedValue({ frames: [], warnings: [] });
    mocks.createDocumentFile.mockResolvedValue({ id: "s", displayName: "s" });

    const html = `<html><body><img src="workspace://img-1"><video src="workspace://vid-1"></video>
      <script>window.MOBILE_AGENT_VIDEO = { duration: 2, fps: 5, render: function () {},
        audio: { tracks: [{ file: "workspace://audio-1" }] } };</script></body></html>`;
    // Unknown to getById: if audio inlining ran, this would throw there.
    // Zero frames throws after the preview resolves — assert on the doc instead.
    await expect(execute(tool, { html, duration: 2 })).rejects.toThrow(/no frames/);
    const doc = mocks.requestScenePreview.mock.calls[0][0] as string;
    expect(doc).not.toContain("workspace://img-1");
    expect(doc).not.toContain("workspace://vid-1");
    expect(doc).toContain("workspace://audio-1");
  });

  it("fails fast on a duration mismatch", async () => {
    await expect(
      execute(makeTool(), { html: SCENE_6S, duration: 20 }),
    ).rejects.toThrow(/does not match/);
    expect(mocks.requestScenePreview).not.toHaveBeenCalled();
  });

  it("throws a useful error when no frames come back", async () => {
    const records: ToolExecutionRecord[] = [];
    mocks.requestScenePreview.mockResolvedValue({
      frames: [],
      warnings: ["media blew up"],
    });
    const tool = createPreviewSceneTool({
      repository: repository(),
      onRecord: (record) => records.push(record),
    });

    await expect(execute(tool, { html: SCENE_6S, duration: 6 })).rejects.toThrow(
      /no frames.*media blew up/,
    );
    expect(records.at(-1)).toMatchObject({
      toolName: "previewScene",
      status: "failed",
    });
  });

  it("returns file links with an OCR hint without image input", async () => {
    const out = (await execute(makeTool(false), {
      html: SCENE_6S,
      duration: 6,
      times: [2],
      name: "intro",
    })) as {
      text: string;
      frames: { fileId: string; link: string }[];
      content?: unknown;
    };

    expect(out.frames).toHaveLength(1);
    expect(out).not.toHaveProperty("content");
    expect(out.text).toMatch(/ocr tool/);
    expect(mocks.createDocumentFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "intro-preview-2s.jpg" }),
    );
  });

  it("exposes toModelOutput that converts storyboard bytes to vision content", async () => {
    const tool = makeTool();
    const out = await execute(tool, {
      html: SCENE_6S,
      duration: 6,
      times: [0, 3],
    });
    const def = tool as unknown as {
      toModelOutput: (args: { output: unknown }) => unknown;
    };
    // Regression guard: without this adapter the SDK ships the raw execute
    // return (JPEG bytes included) as a JSON blob and the model never sees
    // the storyboard.
    expect(typeof def.toModelOutput).toBe("function");
    const modelOutput = def.toModelOutput({ output: out }) as {
      type: string;
      value: {
        type: string;
        text?: string;
        mediaType?: string;
        data?: { type?: string; data?: unknown };
      }[];
    };
    expect(modelOutput.type).toBe("content");
    expect(modelOutput.value[0]).toMatchObject({ type: "text" });
    const files = modelOutput.value.slice(1);
    expect(files).toHaveLength(1);
    for (const file of files) {
      expect(file.type).toBe("file");
      expect(file.mediaType).toBe("image/jpeg");
      expect(file.data?.type).toBe("data");
      expect(file.data?.data).toBeInstanceOf(Uint8Array);
    }
  });

  it("keeps full-resolution individual frames opt-in", async () => {
    const out = await execute(makeTool(), { html: SCENE_6S, times: [0, 3], layout: "frames" }) as { content: unknown[]; frameCount: number };
    expect(mocks.createContactSheet).not.toHaveBeenCalled();
    expect(mocks.createDocumentFile).toHaveBeenCalledTimes(2);
    expect(out.content).toHaveLength(3);
    expect(out.frameCount).toBe(2);
  });

  it("toModelOutput falls back to text without image input", async () => {
    const tool = makeTool(false);
    const out = (await execute(tool, {
      html: SCENE_6S,
      duration: 6,
      times: [2],
    })) as { text: string };
    const def = tool as unknown as {
      toModelOutput: (args: { output: unknown }) => unknown;
    };
    expect(def.toModelOutput({ output: out })).toEqual({
      type: "text",
      value: out.text,
    });
  });
});
