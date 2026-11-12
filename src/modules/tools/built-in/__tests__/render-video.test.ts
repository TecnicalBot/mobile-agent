import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTextFile: vi.fn(),
  createDocumentFileFromFile: vi.fn(),
  requestVideoRender: vi.fn(),
  onRecord: vi.fn(),
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({
    createTextFile: mocks.createTextFile,
    createDocumentFileFromFile: mocks.createDocumentFileFromFile,
  }),
  resolveWorkspaceFile: vi.fn(),
}));

vi.mock("@/modules/preview/video-render", () => ({
  requestVideoRender: mocks.requestVideoRender,
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));

const { createRenderVideoTool } = await import(
  "@/modules/tools/built-in/render-video"
);

const HTML_6S =
  '<html><script>window.MOBILE_AGENT_VIDEO = { duration: 6, fps: 30, render: function () {} };</script></html>';

function makeTool() {
  mocks.createTextFile.mockResolvedValue({
    id: "source-1",
    displayName: "clip.source.html",
  });
  mocks.createDocumentFileFromFile.mockResolvedValue({
    id: "video-1",
    displayName: "clip.mp4",
    size: 1234,
  });
  mocks.requestVideoRender.mockResolvedValue({
    uri: "file:///cache/v.mp4",
    sizeBytes: 1234,
    hasAudio: true,
    audioWarnings: [],
  });
  return createRenderVideoTool({
    repository: {} as never,
    onRecord: mocks.onRecord,
  });
}

async function execute(tool: ReturnType<typeof makeTool>, input: object) {
  const def = tool as unknown as {
    execute: (input: object, opts: object) => Promise<unknown>;
  };
  return def.execute(input, {});
}

describe("renderVideo source persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the source HTML and returns its fileId with the render", async () => {
    const output = (await execute(makeTool(), {
      html: HTML_6S,
      name: "clip.mp4",
      duration: 6,
    })) as Record<string, unknown>;

    expect(mocks.createTextFile).toHaveBeenCalledWith({
      content: HTML_6S,
      mimeType: "text/html",
      name: "clip.source.html",
    });
    expect(output).toMatchObject({
      fileId: "video-1",
      duration: 6,
      hasAudio: true,
      sourceFileId: "source-1",
      sourceLink: "workspace://source-1",
    });
  });

  it("still saves the source when the duration check fails", async () => {
    await expect(
      execute(makeTool(), { html: HTML_6S, name: "clip.mp4", duration: 20 }),
    ).rejects.toThrow(/does not match the requested duration/);
    expect(mocks.createTextFile).toHaveBeenCalledTimes(1);
    expect(mocks.requestVideoRender).not.toHaveBeenCalled();
  });

  it("renders without a requested duration and reports the contract one", async () => {
    const output = (await execute(makeTool(), {
      html: HTML_6S,
      name: "clip.mp4",
    })) as Record<string, unknown>;
    expect(output).toMatchObject({ duration: 6, sourceFileId: "source-1" });
  });

  it("records a human-readable preview instead of raw byte counts", async () => {
    await execute(makeTool(), { html: HTML_6S, name: "clip.mp4", duration: 6 });
    const preview = mocks.onRecord.mock.calls[0][0].preview as {
      title: string;
      text: string;
    };

    expect(preview.title).toBe("clip.mp4");
    expect(preview.text).toBe("6s · 1.2 KB · with audio");
  });
});

describe("renderVideo asset inlining", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inlines image, video, and audio assets without cross-talk", async () => {
    const { resolveWorkspaceFile } = await import(
      "@/core/services/workspace-file-service"
    );
    const records: Record<string, { id: string; displayName: string; mimeType: string; relativePath: string }> = {
      "audio-1": { id: "audio-1", displayName: "song.mp3", mimeType: "audio/mpeg", relativePath: "audio-1/song.mp3" },
      "img-1": { id: "img-1", displayName: "photo.jpg", mimeType: "image/jpeg", relativePath: "img-1/photo.jpg" },
      "vid-1": { id: "vid-1", displayName: "clip.mp4", mimeType: "video/mp4", relativePath: "vid-1/clip.mp4" },
    };
    const repository = {
      getById: async (id: string) => records[id] ?? null,
    };
    vi.mocked(resolveWorkspaceFile).mockReturnValue({
      exists: true,
      bytes: async () => new Uint8Array([1, 2, 3, 4]),
    } as never);
    mocks.createTextFile.mockResolvedValue({ id: "source-1", displayName: "clip.source.html" });
    mocks.createDocumentFileFromFile.mockResolvedValue({ id: "video-1", displayName: "clip.mp4", size: 8 });
    mocks.requestVideoRender.mockResolvedValue({
      uri: "file:///cache/v.mp4",
      sizeBytes: 8,
      hasAudio: true,
      audioWarnings: [],
    });

    const html = `<html><body>
      <img id="photo" src="workspace://img-1">
      <video id="bg" muted playsinline src="workspace://vid-1"></video>
      <script>window.MOBILE_AGENT_VIDEO = { duration: 6, fps: 30,
        render: function () {},
        audio: { tracks: [{ file: "workspace://audio-1", start: 0 }] } };</script>
      </body></html>`;
    const tool = createRenderVideoTool({
      repository: repository as never,
      onRecord: mocks.onRecord,
    });
    const output = (await execute(tool, {
      html,
      name: "clip.mp4",
      duration: 6,
    })) as Record<string, unknown>;

    const renderedHtml = mocks.requestVideoRender.mock.calls[0][0] as string;
    expect(renderedHtml).not.toContain("workspace://");
    expect(renderedHtml).toContain("data:image/jpeg;base64,");
    expect(renderedHtml).toContain("data:video/mp4;base64,");
    expect(renderedHtml).toContain("data:audio/mpeg;base64,");
    expect(output).toMatchObject({
      audioFiles: ["song.mp3"],
      imageFiles: ["photo.jpg"],
      videoFiles: ["clip.mp4"],
    });
  });

  it("accepts the original MP4 as both the visual source and the soundtrack", async () => {
    const { resolveWorkspaceFile } = await import("@/core/services/workspace-file-service");
    vi.mocked(resolveWorkspaceFile).mockReturnValue({ exists: true, size: 4,
      bytes: async () => new Uint8Array([1, 2, 3, 4]),
    } as never);
    makeTool();
    const tool = createRenderVideoTool({ repository: {
      getById: async () => ({ id: "main-1", displayName: "original.mp4", mimeType: "video/mp4", relativePath: "original.mp4" }),
    } as never });
    const output = await execute(tool, { html: `<html><video muted src="workspace://main-1"></video>
      <script>window.MOBILE_AGENT_VIDEO={duration:6,render:function(){},audio:{master:1,tracks:[{file:"workspace://main-1",volume:1}]}};</script></html>` });
    expect(output).toMatchObject({ audioFiles: ["original.mp4"], videoFiles: ["original.mp4"], hasAudio: true });
    expect(mocks.requestVideoRender.mock.calls[0][0]).not.toContain("workspace://");
  });
});
