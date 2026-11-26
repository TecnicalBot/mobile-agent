import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  albumCreate: vi.fn(),
  assetCreate: vi.fn(),
  createDocumentFileFromFile: vi.fn(),
  createTextFile: vi.fn(),
  downloadFile: vi.fn(),
  hashDocumentKey: vi.fn(() => "hash-1"),
  onRecord: vi.fn(),
  renderSegments: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  resolveHtml: vi.fn(),
  writeEditorZip: vi.fn(),
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  createWorkspaceFileService: () => ({
    createTextFile: mocks.createTextFile,
    createDocumentFileFromFile: mocks.createDocumentFileFromFile,
  }),
  resolveWorkspaceFile: (relativePath: string) => {
    const name = relativePath.split("/").pop() ?? relativePath;
    return {
      uri: `file:///docs/${name}`,
      name,
      exists: true,
      size: 1234,
    };
  },
  sanitizeFileName: (name: string) => name,
}));

vi.mock("@/core/services/download-service", () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock("@/modules/preview/render-segments", () => ({
  hashDocumentKey: mocks.hashDocumentKey,
  renderSegments: mocks.renderSegments,
}));

vi.mock("@/modules/preview/editor-zip", () => ({
  writeEditorZip: mocks.writeEditorZip,
}));

vi.mock("@/modules/preview/video-assets", () => ({
  inlineAudioAssets: async (html: string) => ({ html, audioFiles: [] }),
  inlineImageAssets: async (html: string) => ({ html, imageFiles: [] }),
  inlineVideoAssets: async (html: string) => ({
    html,
    videoFiles: [],
    warnings: [],
  }),
}));

vi.mock("@/modules/tools/built-in/render-video", () => ({
  resolveHtml: mocks.resolveHtml,
}));

vi.mock("@/modules/preview/video-render", () => ({
  MAX_VIDEO_DURATION_SECONDS: 600,
}));

vi.mock("expo-media-library", () => ({
  Album: { create: mocks.albumCreate },
  Asset: { create: mocks.assetCreate },
  requestPermissionsAsync: mocks.requestPermissionsAsync,
}));

vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache" } },
  File: class {
    uri: string;
    constructor(uriOrDir: string | { uri: string }, name?: string) {
      if (typeof uriOrDir === "string" && name !== undefined) {
        this.uri = `${uriOrDir}/${name}`;
      } else if (typeof uriOrDir === "string") {
        this.uri = uriOrDir;
      } else {
        const base = uriOrDir.uri.replace(/\/$/, "");
        this.uri = name !== undefined ? `${base}/${name}` : base;
      }
    }
    create() {}
    async move() {}
    delete() {}
  },
  Directory: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {}
  },
}));

const { createExportEditorPackageTool } =
  await import("@/modules/tools/built-in/export-editor-package");

const HTML_10S =
  '<html><script>window.MOBILE_AGENT_VIDEO = { duration: 10, fps: 30, width: 1280, height: 720, shots: [{ id: "intro", start: 0, end: 5, render: function () {} }, { id: "end", start: 5, end: 10, render: function () {} }], render: function () {} };</script></html>';

const clips = [
  {
    id: "shot-intro",
    label: "intro",
    fileName: "01-intro.mp4",
    uri: "file:///cache/pkg/01-intro.mp4",
    start: 0,
    end: 5,
    duration: 5,
    hasAudio: true,
    shotId: "intro",
  },
  {
    id: "shot-end",
    label: "end",
    fileName: "02-end.mp4",
    uri: "file:///cache/pkg/02-end.mp4",
    start: 5,
    end: 10,
    duration: 5,
    hasAudio: true,
    shotId: "end",
  },
];

function makeTool() {
  return createExportEditorPackageTool({
    conversationId: "chat-editor",
    repository: {} as never,
    onRecord: mocks.onRecord,
  });
}

type ToolLike = {
  execute: (input: object, opts: object) => Promise<unknown>;
};

async function execute(tool: unknown, input: object) {
  return (tool as ToolLike).execute(input, {});
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveHtml.mockResolvedValue(HTML_10S);
  mocks.createTextFile
    .mockResolvedValueOnce({
      id: "source-1",
      displayName: "demo.source.html",
      relativePath: "source-1/demo.source.html",
    })
    .mockResolvedValueOnce({
      id: "alight-1",
      displayName: "demo-alight.xml",
      relativePath: "alight-1/demo-alight.xml",
    });
  mocks.renderSegments.mockResolvedValue({
    uri: "file:///cache/pkg/full.mp4",
    hasAudio: true,
    audioWarnings: [],
    warnings: ["joined clips"],
    perfWarnings: [],
    visualWarnings: [],
    duration: 10,
    clips,
    editorPackage: {
      directoryUri: "file:///cache/pkg",
      fps: 30,
      width: 1280,
      height: 720,
    },
  });
  mocks.requestPermissionsAsync.mockResolvedValue({ granted: true });
  mocks.albumCreate.mockResolvedValue({});
  mocks.assetCreate.mockImplementation(async (uri: string) => ({
    id: `content://media/${uri.split("/").pop()}`,
    getUri: async () => uri,
  }));
  mocks.writeEditorZip.mockResolvedValue(undefined);
  mocks.createDocumentFileFromFile
    .mockResolvedValueOnce({
      id: "zip-1",
      displayName: "demo-editor-package.zip",
      relativePath: "zip-1/demo-editor-package.zip",
      size: 999,
    })
    .mockResolvedValueOnce({
      id: "video-1",
      displayName: "demo.mp4",
      size: 5000,
    });
  mocks.downloadFile.mockResolvedValue({
    uri: "content://downloads/demo-editor-package.zip",
  });
});

describe("exportEditorPackage", () => {
  it("renders editor clips, saves the album, ZIP, and playable video", async () => {
    const output = (await execute(makeTool(), {
      html: HTML_10S,
      name: "demo",
      duration: 10,
    })) as Record<string, unknown>;

    expect(mocks.createTextFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: HTML_10S,
        mimeType: "text/html",
        name: "demo.source.html",
      }),
    );
    expect(mocks.createTextFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: expect.stringContaining("<scene"),
        mimeType: "application/xml",
        name: "demo-alight.xml",
      }),
    );
    expect(mocks.renderSegments).toHaveBeenCalledWith(
      expect.objectContaining({
        contractDuration: 10,
        editorClips: true,
        sourceFileId: "hash-1",
      }),
    );

    // Clips and the finished video go into the album before the ZIP source is
    // moved out of the package directory.
    expect(mocks.assetCreate).toHaveBeenCalledTimes(3);
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      1,
      "file:///cache/pkg/01-intro.mp4",
    );
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      3,
      "file:///cache/pkg/demo.mp4",
    );
    expect(mocks.albumCreate).toHaveBeenCalledWith(
      "Mobile Agent Edits",
      [
        expect.objectContaining({
          id: "content://media/01-intro.mp4",
        }),
        expect.objectContaining({ id: "content://media/02-end.mp4" }),
        expect.objectContaining({ id: "content://media/demo.mp4" }),
      ],
      false,
    );

    const zipEntries = mocks.writeEditorZip.mock.calls[0][1] as {
      kind: string;
      name: string;
      text?: string;
    }[];
    const names = zipEntries.map((entry) => entry.name);
    expect(names).toContain("clips/01-intro.mp4");
    expect(names).toContain("clips/02-end.mp4");
    expect(names).toContain("timeline-alight.xml");
    expect(names).toContain("timeline.fcpxml");
    expect(names).toContain("timeline-fcp7.xml");
    expect(names).toContain("timeline.otio");
    expect(names).toContain("timeline.edl");
    expect(names).toContain("shots.csv");
    expect(names).toContain("README.txt");
    // The Alight Motion project points at the gallery copies, not the ZIP.
    const alight = zipEntries.find(
      (entry) => entry.name === "timeline-alight.xml",
    );
    expect(alight?.text).toContain('fillVideo="content://media/01-intro.mp4"');
    // The finished video is delivered separately, not duplicated in the ZIP.
    expect(names).not.toContain("full.mp4");

    expect(mocks.createDocumentFileFromFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        mimeType: "application/zip",
        name: "demo-editor-package.zip",
      }),
    );
    expect(mocks.createDocumentFileFromFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mimeType: "video/mp4", name: "demo.mp4" }),
    );
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      "file:///docs/demo-editor-package.zip",
      "demo-editor-package.zip",
      "application/zip",
    );
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      "file:///docs/demo-alight.xml",
      "demo-alight.xml",
      "application/xml",
    );

    expect(output).toMatchObject({
      fileId: "zip-1",
      link: "workspace://zip-1",
      videoFileId: "video-1",
      videoLink: "workspace://video-1",
      videoDuration: 10,
      galleryAlbum: "Mobile Agent Edits",
      downloadsUri: "content://downloads/demo-editor-package.zip",
      clipCount: 2,
      fps: 30,
      width: 1280,
      height: 720,
      sourceFileId: "source-1",
      alightFileId: "alight-1",
      alightLink: "workspace://alight-1",
      alightDisplayName: "demo-alight.xml",
    });
    expect(output.clips).toEqual([
      {
        fileName: "01-intro.mp4",
        label: "intro",
        start: 0,
        end: 5,
        duration: 5,
        hasAudio: true,
        shotId: "intro",
      },
      {
        fileName: "02-end.mp4",
        label: "end",
        start: 5,
        end: 10,
        duration: 5,
        hasAudio: true,
        shotId: "end",
      },
    ]);
    expect(mocks.onRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "exportEditorPackage",
        status: "completed",
      }),
    );
  });

  it("exports declared layers with their original media in the gallery", async () => {
    mocks.renderSegments.mockResolvedValue({
      uri: "file:///cache/pkg/full.mp4",
      hasAudio: true,
      audioWarnings: [],
      warnings: [],
      perfWarnings: [],
      visualWarnings: [],
      duration: 10,
      clips,
      editorPackage: {
        directoryUri: "file:///cache/pkg",
        fps: 30,
        width: 1280,
        height: 720,
        layers: [
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
            opacity: 1,
            z: 1,
            fileId: "img-1",
          },
        ],
        clipLayers: [
          {
            id: "base",
            label: "Base",
            start: 0,
            end: 5,
            from: 1,
            fileId: "vid-1",
          },
        ],
      },
    });
    const getById = vi.fn(async (id: string) => ({
      id,
      displayName: id === "img-1" ? "photo.jpg" : "clip.mp4",
      mimeType: id === "img-1" ? "image/jpeg" : "video/mp4",
      size: 1234,
      relativePath: `${id}/${id === "img-1" ? "photo.jpg" : "clip.mp4"}`,
    }));

    await execute(
      createExportEditorPackageTool({
        conversationId: "chat-editor",
        repository: { getById } as never,
        onRecord: mocks.onRecord,
      }),
      { html: HTML_10S, name: "demo", duration: 10 },
    );

    // Clip renders first, then the original image and video, then the full
    // video, so gallery URIs map back to the declared layers.
    expect(mocks.assetCreate).toHaveBeenCalledTimes(5);
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      1,
      "file:///cache/pkg/01-intro.mp4",
    );
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      2,
      "file:///cache/pkg/02-end.mp4",
    );
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      3,
      "file:///docs/photo.jpg",
    );
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      4,
      "file:///docs/clip.mp4",
    );
    expect(mocks.assetCreate).toHaveBeenNthCalledWith(
      5,
      "file:///cache/pkg/demo.mp4",
    );
    expect(getById).toHaveBeenCalledWith("img-1");
    expect(getById).toHaveBeenCalledWith("vid-1");

    const zipEntries = mocks.writeEditorZip.mock.calls[0][1] as {
      name: string;
      text?: string;
    }[];
    const alight = zipEntries.find(
      (entry) => entry.name === "timeline-alight.xml",
    );
    expect(alight?.text).toContain('fillImage="content://media/photo.jpg"');
    expect(alight?.text).toContain('fillVideo="content://media/clip.mp4"');
    expect(alight?.text).toContain("<content>Black holes</content>");
    expect(alight?.text).not.toContain('fillVideo="clips/01-intro.mp4"');
  });

  it("still delivers the package when gallery access is denied", async () => {
    mocks.requestPermissionsAsync.mockResolvedValue({ granted: false });

    const output = (await execute(makeTool(), {
      html: HTML_10S,
      name: "demo",
      duration: 10,
    })) as { galleryAlbum: unknown; warnings: string[] };

    expect(mocks.albumCreate).not.toHaveBeenCalled();
    expect(output.galleryAlbum).toBeNull();
    expect(output.warnings.join(" ")).toMatch(/Gallery access was not granted/);
  });

  it("warns instead of failing when the Downloads copy fails", async () => {
    mocks.downloadFile.mockRejectedValue(new Error("no storage permission"));

    const output = (await execute(makeTool(), {
      html: HTML_10S,
      name: "demo",
      duration: 10,
    })) as { downloadsUri: unknown; warnings: string[] };

    expect(output.downloadsUri).toBeNull();
    expect(output.warnings.join(" ")).toMatch(/copying it to Downloads failed/);
  });

  it("fails fast on a duration mismatch before rendering", async () => {
    await expect(
      execute(makeTool(), { html: HTML_10S, name: "demo", duration: 30 }),
    ).rejects.toThrow(/does not match the requested duration/);

    expect(mocks.renderSegments).not.toHaveBeenCalled();
    expect(mocks.albumCreate).not.toHaveBeenCalled();
    expect(mocks.onRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "exportEditorPackage",
        status: "failed",
      }),
    );
  });
});
