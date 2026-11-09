import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getThumbnailAsync: vi.fn(),
  createDocumentFile: vi.fn(),
  onRecord: vi.fn(),
  files: new Map<string, { bytes: Uint8Array }>(),
  createContactSheet: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock("@/modules/preview/contact-sheet", () => ({
  MAX_CONTACT_SHEET_FRAMES: 12,
  createContactSheet: mocks.createContactSheet,
}));

vi.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: mocks.getThumbnailAsync,
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({
    createDocumentFile: mocks.createDocumentFile,
  }),
  resolveWorkspaceFile: () => ({
    exists: true,
    uri: "file:///workspace/vid.mp4",
  }),
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async bytes() {
      return mocks.files.get(this.uri)?.bytes ?? new Uint8Array(0);
    }
    async base64() { return "QUJD"; }
    delete() { mocks.deleteFile(this.uri); }
  },
}));

const { createVideoFrameTool } = await import(
  "@/modules/tools/built-in/video-frame"
);

const VIDEO_RECORD = {
  id: "video-1",
  displayName: "clip.mp4",
  relativePath: "video-1/clip.mp4",
};

function makeTool(supportsImageInput = true) {
  mocks.getById.mockResolvedValue(VIDEO_RECORD);
  mocks.getThumbnailAsync.mockResolvedValue({
    uri: "file:///cache/frame.jpg",
    width: 1280,
    height: 720,
  });
  mocks.files.set("file:///cache/frame.jpg", {
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  });
  mocks.createDocumentFile.mockResolvedValue({
    id: "frame-1",
    displayName: "clip-frame-12s.jpg",
    size: 4,
  });
  return createVideoFrameTool({
    repository: { getById: mocks.getById } as never,
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

describe("getVideoFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
  });

  it("captures a sorted deduplicated batch and sends exactly one image", async () => {
    const tool = makeTool() as any;
    mocks.createContactSheet.mockResolvedValue({ base64: "QUJD", width: 960, height: 268 });
    const out = await execute(tool, { fileId: "video-1", times: [10, 0, 5, 5] }) as any;
    expect(mocks.getThumbnailAsync.mock.calls.map((call) => call[1].time)).toEqual([0, 5000, 10000]);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(3);
    expect(mocks.createContactSheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ time: 5 })]), undefined);
    expect(mocks.createDocumentFile).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ times: [0, 5, 10], frameCount: 3, width: 960 });
    const converted = tool.toModelOutput({ output: out });
    expect(converted.value.filter((part: any) => part.type === "file")).toHaveLength(1);
    expect(out.text).toContain("2=5s");
  });

  it("merges time and times instead of rejecting the request", async () => {
    const tool = makeTool() as any;
    mocks.createContactSheet.mockResolvedValue({ base64: "QUJD", width: 960, height: 268 });
    const out = await execute(tool, {
      fileId: "video-1",
      time: 20,
      times: [10, 0],
    }) as any;
    expect(mocks.getThumbnailAsync.mock.calls.map((call) => call[1].time)).toEqual([0, 10000, 20000]);
    expect(out.times).toEqual([0, 10, 20]);
    await expect(execute(tool, { fileId: "video-1", times: [] })).rejects.toThrow(/at least one/);
    await expect(execute(tool, { fileId: "video-1", times: Array.from({ length: 13 }, (_, index) => index) })).rejects.toThrow(/at most 12/);
    expect(mocks.getThumbnailAsync).toHaveBeenCalledTimes(3);
  });

  it("uses the full-resolution path for a single timestamp in times", async () => {
    const output = (await execute(makeTool(), {
      fileId: "video-1",
      times: [12],
    })) as Record<string, unknown>;
    expect(mocks.createContactSheet).not.toHaveBeenCalled();
    expect(output.time).toBe(12);
  });

  it("stops a batch when cancelled", async () => {
    const tool = makeTool() as any;
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute({ fileId: "video-1", times: [0, 1] }, { abortSignal: controller.signal })).rejects.toThrow();
    expect(mocks.getThumbnailAsync).not.toHaveBeenCalled();
  });

  it("returns frame metadata with bytes for the model-output converter", async () => {
    const output = (await execute(makeTool(true), {
      fileId: "video-1",
      time: 12,
    })) as Record<string, unknown>;

    expect(mocks.getThumbnailAsync).toHaveBeenCalledWith(
      "file:///workspace/vid.mp4",
      { time: 12000, quality: 0.9 },
    );
    expect(mocks.createDocumentFile).toHaveBeenCalledWith({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      mimeType: "image/jpeg",
      name: "clip-frame-12s.jpg",
    });
    expect(output).toMatchObject({
      fileId: "frame-1",
      link: "workspace://frame-1",
      time: 12,
      inlineImage: true,
    });
    expect(output.image).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  });

  it("converts vision output to a real image content part", async () => {
    const tool = makeTool(true) as unknown as {
      execute: (
        input: object,
        opts: object,
      ) => Promise<Record<string, unknown>>;
      toModelOutput: (args: {
        toolCallId: string;
        input: unknown;
        output: Record<string, unknown>;
      }) => unknown;
    };
    const output = await tool.execute({ fileId: "video-1", time: 12 }, {});
    const modelOutput = tool.toModelOutput({
      toolCallId: "call-1",
      input: { fileId: "video-1", time: 12 },
      output,
    }) as {
      type: string;
      value: Record<string, unknown>[];
    };

    expect(modelOutput.type).toBe("content");
    expect(modelOutput.value[0]).toMatchObject({ type: "text" });
    expect(modelOutput.value[1]).toMatchObject({
      type: "file",
      mediaType: "image/jpeg",
    });
  });

  it("converts non-vision output to plain text with ocr guidance", async () => {
    const tool = makeTool(false) as unknown as {
      execute: (
        input: object,
        opts: object,
      ) => Promise<Record<string, unknown>>;
      toModelOutput: (args: {
        toolCallId: string;
        input: unknown;
        output: Record<string, unknown>;
      }) => unknown;
    };
    const output = await tool.execute({ fileId: "video-1", time: 12 }, {});
    expect(output.image).toBeNull();
    expect(output.text).toMatch(/ocr/);
    const modelOutput = tool.toModelOutput({
      toolCallId: "call-1",
      input: { fileId: "video-1", time: 12 },
      output,
    }) as { type: string; value: string };

    expect(modelOutput).toMatchObject({ type: "text" });
    expect(modelOutput.value).toMatch(/ocr/);
  });

  it("fails clearly for unknown videos", async () => {
    mocks.getById.mockResolvedValue(null);
    const tool = createVideoFrameTool({
      repository: { getById: mocks.getById } as never,
      onRecord: mocks.onRecord,
    });
    await expect(execute(tool, { fileId: "nope", time: 1 })).rejects.toThrow(
      /No workspace file found/,
    );
  });
});
