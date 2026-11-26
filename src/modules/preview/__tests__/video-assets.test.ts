import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  exists: true,
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  resolveWorkspaceFile: vi.fn(),
}));

vi.mock("@/core/services/workspace-file-service", () => ({
  resolveWorkspaceFile: mocks.resolveWorkspaceFile,
}));

const nativeMocks = vi.hoisted(() => ({
  transcodeClip: vi.fn(),
  // Undefined by default: without the op the module mirrors real builds that
  // predate seek proxies and every served clip keeps its original URL.
  // Proxy tests assign a mock per test.
  makeSeekProxy: undefined as (() => Promise<unknown>) | undefined,
  // Same gate for the WAV soundtrack decode lane.
  decodeAudioWav: undefined as (() => Promise<unknown>) | undefined,
  outExists: true,
  outBytes: new Uint8Array([0x00, 0x00, 0x00, 0x18]),
  deleted: [] as string[],
  moved: [] as string[],
}));

vi.mock("html-video-export", () => ({
  getHtmlVideoExportModule: () => {
    const module: Record<string, unknown> = {
      transcodeClip: nativeMocks.transcodeClip,
    };
    if (nativeMocks.makeSeekProxy) {
      module.makeSeekProxy = nativeMocks.makeSeekProxy;
    }
    if (nativeMocks.decodeAudioWav) {
      module.decodeAudioWav = nativeMocks.decodeAudioWav;
    }
    return module;
  },
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(
      public dir: unknown,
      public name: string,
    ) {
      this.uri = `file:///cache/${name}`;
    }
    get exists() {
      return nativeMocks.outExists;
    }
    async bytes() {
      return nativeMocks.outBytes;
    }
    delete() {
      nativeMocks.deleted.push(this.name);
    }
    async move(dest: { name?: string }) {
      nativeMocks.moved.push(dest?.name ?? "unknown");
    }
  },
  Paths: { cache: "mock-cache-dir" },
}));

const serverMocks = vi.hoisted(() => ({
  baseUrl: null as string | null,
}));

vi.mock("@/modules/preview/asset-server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/preview/asset-server")>();
  return {
    ...actual,
    ensureAssetServer: async () => serverMocks.baseUrl,
  };
});

const {
  assertImageFileUsable,
  assertVideoFileUsable,
  extractWorkspaceImageIds,
  extractWorkspaceVideoIds,
  hasWorkspaceRefs,
  inlineAudioAssets,
  inlineImageAssets,
  inlineVideoAssets,
  isTranscodeOnlyVideoMimeType,
  resolveImageMimeType,
  resolveVideoMimeType,
} = await import("@/modules/preview/video-assets");

function repository() {
  return { getById: mocks.getById } as never;
}

function workspaceFile(displayName: string, mimeType: string | null) {
  mocks.getById.mockImplementation(async (id: string) => ({
    id,
    displayName,
    mimeType,
    relativePath: `${id}/${displayName}`,
  }));
  mocks.resolveWorkspaceFile.mockReturnValue({
    get exists() {
      return mocks.exists;
    },
    bytes: async () => mocks.bytes,
  });
}

beforeEach(() => {
  mocks.getById.mockReset();
  mocks.resolveWorkspaceFile.mockReset();
  mocks.exists = true;
  mocks.bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  serverMocks.baseUrl = null;
  nativeMocks.makeSeekProxy = undefined;
  nativeMocks.decodeAudioWav = undefined;
  nativeMocks.moved = [];
  nativeMocks.deleted = [];
});

describe("extractWorkspaceImageIds", () => {
  it("finds img sources and dedupes repeats", () => {
    const html = `<img src="workspace://pic-1"><IMG SRC='workspace://pic-1'><img src="workspace://pic-2">`;

    expect(extractWorkspaceImageIds(html)).toEqual(["pic-1", "pic-2"]);
  });

  it("ignores audio tracks and video tags", () => {
    const html = `<video src="workspace://clip-1"></video>
      <script>var s = { file: "workspace://song-1" };</script>
      <img src="https://example.com/x.png">`;

    expect(extractWorkspaceImageIds(html)).toEqual([]);
  });
});

describe("extractWorkspaceVideoIds", () => {
  it("finds video and source tags", () => {
    const html = `<video src="workspace://clip-1"><source src="workspace://clip-2"></video>`;

    expect(extractWorkspaceVideoIds(html)).toEqual(["clip-1", "clip-2"]);
  });

  it("ignores audio tracks and img tags", () => {
    const html = `<img src="workspace://pic-1">
      <script>var s = { file: "workspace://song-1" };</script>`;

    expect(extractWorkspaceVideoIds(html)).toEqual([]);
  });
});

describe("resolveImageMimeType", () => {
  it("prefers a supported declared mime type", () => {
    expect(resolveImageMimeType("image/png", "photo.jpg")).toBe("image/png");
  });

  it("falls back to the file extension", () => {
    expect(resolveImageMimeType(null, "photo.webp")).toBe("image/webp");
    expect(resolveImageMimeType("application/octet-stream", "pic.gif")).toBe(
      "image/gif",
    );
  });

  it("returns null for unsupported types", () => {
    expect(resolveImageMimeType("image/svg+xml", "art.svg")).toBeNull();
    expect(resolveImageMimeType(null, "clip.mp4")).toBeNull();
  });
});

describe("resolveVideoMimeType", () => {
  it("prefers a supported declared mime type", () => {
    expect(resolveVideoMimeType("video/webm", "clip.mp4")).toBe("video/webm");
  });

  it("falls back to the file extension", () => {
    expect(resolveVideoMimeType(null, "clip.m4v")).toBe("video/mp4");
  });

  it("returns null for unsupported types", () => {
    expect(resolveVideoMimeType(null, "song.mp3")).toBeNull();
    expect(resolveVideoMimeType("video/avi", "clip.avi")).toBeNull();
  });

  it("resolves MOV as transcode-only, never direct-playable", () => {
    expect(resolveVideoMimeType("video/quicktime", "clip.mov")).toBe(
      "video/quicktime",
    );
    expect(resolveVideoMimeType(null, "clip.mov")).toBe("video/quicktime");
    expect(isTranscodeOnlyVideoMimeType("video/quicktime")).toBe(true);
    expect(isTranscodeOnlyVideoMimeType("video/mp4")).toBe(false);
  });
});

describe("assertImageFileUsable", () => {
  it("rejects unsupported formats, empties, and oversized files", () => {
    expect(() =>
      assertImageFileUsable("art.svg", "image/svg+xml", 100),
    ).toThrow(/not a supported image/);
    expect(() => assertImageFileUsable("a.png", "image/png", 0)).toThrow(
      /empty/,
    );
    expect(() =>
      assertImageFileUsable("big.jpg", "image/jpeg", 16 * 1024 * 1024),
    ).toThrow(/too large/);
  });
});

describe("assertVideoFileUsable", () => {
  it("rejects unsupported formats, empties, and oversized files", () => {
    expect(() => assertVideoFileUsable("c.avi", "video/avi", 100)).toThrow(
      /not a supported video/,
    );
    expect(() => assertVideoFileUsable("c.mp4", "video/mp4", 0)).toThrow(
      /empty/,
    );
    expect(() =>
      assertVideoFileUsable("big.mp4", "video/mp4", 16 * 1024 * 1024),
    ).toThrow(/too large/);
  });

  it("rejects MOV on the direct path (must convert first)", () => {
    expect(() =>
      assertVideoFileUsable("c.mov", "video/quicktime", 100),
    ).toThrow(/needs conversion/);
  });
});

describe("inlineImageAssets", () => {
  it("replaces every img reference with a data URI", async () => {
    workspaceFile("photo.jpg", "image/jpeg");
    const html = `<img id="a" src="workspace://img-1"><img src="workspace://img-1">`;

    const { html: out, imageFiles } = await inlineImageAssets(
      html,
      repository(),
    );

    expect(imageFiles).toEqual(["photo.jpg"]);
    expect(out).not.toContain("workspace://");
    expect(out).toContain("data:image/jpeg;base64,");
    // The probe needs the original file id to copy the layer source.
    expect(out).toContain('data-mobile-agent-file-id="img-1"');
    expect(out).toContain('data-mobile-agent-asset="image"');
    expect(mocks.getById).toHaveBeenCalledWith("img-1");
  });

  it("passes through HTML with no images", async () => {
    const { html: out, imageFiles } = await inlineImageAssets(
      "<p>nope</p>",
      repository(),
    );

    expect(out).toBe("<p>nope</p>");
    expect(imageFiles).toEqual([]);
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it("fails clearly for unknown, missing, or unusable files", async () => {
    mocks.getById.mockResolvedValue(null);
    await expect(
      inlineImageAssets(`<img src="workspace://gone">`, repository()),
    ).rejects.toThrow(/No workspace image file found/);

    workspaceFile("song.mp3", "audio/mpeg");
    await expect(
      inlineImageAssets(`<img src="workspace://img-1">`, repository()),
    ).rejects.toThrow(/not a supported image/);

    workspaceFile("photo.jpg", "image/jpeg");
    mocks.exists = false;
    await expect(
      inlineImageAssets(`<img src="workspace://img-1">`, repository()),
    ).rejects.toThrow(/no longer available/);
  });
});

describe("inlineVideoAssets", () => {
  it("replaces video and source references with data URIs", async () => {
    workspaceFile("clip.mp4", "video/mp4");
    const html = `<video id="bg" muted playsinline src="workspace://vid-1"></video>`;

    const { html: out, videoFiles } = await inlineVideoAssets(
      html,
      repository(),
    );

    expect(videoFiles).toEqual(["clip.mp4"]);
    expect(out).not.toContain("workspace://");
    expect(out).toContain("data:video/mp4;base64,");
    // The probe resolves a declared clip back to its workspace file.
    expect(out).toContain('data-mobile-agent-file-id="vid-1"');
  });

  it("stamps a nested source tag with its workspace file id", async () => {
    workspaceFile("clip.mp4", "video/mp4");
    const html = `<video muted playsinline><source src="workspace://vid-1"></video>`;

    const { html: out } = await inlineVideoAssets(html, repository());

    expect(out).toContain('<source data-mobile-agent-file-id="vid-1"');
    expect(out).not.toContain("workspace://");
  });

  it("fails clearly for an audio file in a video tag", async () => {
    workspaceFile("song.mp3", "audio/mpeg");
    await expect(
      inlineVideoAssets(`<video src="workspace://vid-1">`, repository()),
    ).rejects.toThrow(/not a supported video/);
  });
});

function bigWorkspaceFile(
  displayName: string,
  mimeType: string | null,
  sizeBytes: number,
) {
  mocks.getById.mockImplementation(async (id: string) => ({
    id,
    displayName,
    mimeType,
    relativePath: `${id}/${displayName}`,
  }));
  mocks.resolveWorkspaceFile.mockReturnValue({
    get exists() {
      return true;
    },
    size: sizeBytes,
    uri: "file:///workspace/big-clip.mp4",
    bytes: async () => {
      throw new Error("original bytes must never be read for over-cap clips");
    },
  });
}

describe("inlineVideoAssets over-cap transcoding", () => {
  const FIFTY_MB = 50 * 1024 * 1024;

  beforeEach(() => {
    nativeMocks.transcodeClip.mockReset();
    nativeMocks.transcodeClip.mockImplementation(async () => ({
      path: "/cache/clip-vid-1.mp4",
      width: 1280,
      height: 720,
      sizeBytes: 8_000_000,
    }));
    nativeMocks.outExists = false;
    nativeMocks.outBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18]);
    nativeMocks.deleted = [];
  });

  it("compresses over-cap clips and warns instead of throwing", async () => {
    bigWorkspaceFile("big-clip.mp4", "video/mp4", FIFTY_MB);
    const {
      html: out,
      videoFiles,
      warnings,
    } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );

    expect(nativeMocks.transcodeClip).toHaveBeenCalledTimes(1);
    const [inPath, outPath, maxBytes, maxDim] = nativeMocks.transcodeClip.mock
      .calls[0] as [string, string, number, number];
    expect(inPath).toBe("/workspace/big-clip.mp4");
    expect(outPath).toContain("clip-vid-1");
    expect(maxBytes).toBe(12 * 1024 * 1024);
    expect(maxDim).toBe(1280);
    expect(videoFiles).toEqual(["big-clip.mp4"]);
    expect(out).toContain("data:video/mp4;base64,");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/compressed/);
  });

  it("reuses an existing transcoded file without re-running the native op", async () => {
    bigWorkspaceFile("big-clip.mp4", "video/mp4", FIFTY_MB);
    nativeMocks.outExists = true;
    const { warnings } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );
    // Cached hit: bytes inlined, warning still reported, no native call.
    expect(nativeMocks.transcodeClip).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
  });

  it("throws the oversize error when the transcode still does not fit", async () => {
    bigWorkspaceFile("big-clip.mp4", "video/mp4", FIFTY_MB);
    nativeMocks.outBytes = new Uint8Array(20 * 1024 * 1024);
    await expect(
      inlineVideoAssets(`<video src="workspace://vid-1">`, repository()),
    ).rejects.toThrow(/too large/);
    expect(nativeMocks.deleted.length).toBeGreaterThan(0);
  });

  it("throws the oversize error when transcoding fails", async () => {
    bigWorkspaceFile("big-clip.mp4", "video/mp4", FIFTY_MB);
    nativeMocks.transcodeClip.mockRejectedValueOnce(new Error("codec missing"));
    await expect(
      inlineVideoAssets(`<video src="workspace://vid-1">`, repository()),
    ).rejects.toThrow(/too large|could not be compressed/);
  });

  it("converts under-cap MOV clips instead of rejecting them", async () => {
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "phone-clip.mov",
      mimeType: "video/quicktime",
      relativePath: `${id}/phone-clip.mov`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 8 * 1024 * 1024,
      uri: "file:///workspace/phone-clip.mov",
      bytes: async () => {
        throw new Error("MOV bytes must never inline directly");
      },
    });
    const {
      html: out,
      videoFiles,
      warnings,
    } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );
    expect(nativeMocks.transcodeClip).toHaveBeenCalledTimes(1);
    expect(videoFiles).toEqual(["phone-clip.mov"]);
    expect(out).toContain("data:video/mp4;base64,");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/MOV.*converted to MP4/);
  });

  it("still rejects containers nothing can play", async () => {
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "clip.avi",
      mimeType: "video/avi",
      relativePath: `${id}/clip.avi`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 1024,
      uri: "file:///workspace/clip.avi",
      bytes: async () => new Uint8Array([1, 2, 3, 4]),
    });
    await expect(
      inlineVideoAssets(`<video src="workspace://vid-1">`, repository()),
    ).rejects.toThrow(/not a supported video/);
    expect(nativeMocks.transcodeClip).not.toHaveBeenCalled();
  });
});

describe("inlineAudioAssets", () => {
  const schedule = (id: string) =>
    `<script>window.MOBILE_AGENT_VIDEO = { audio: { tracks: [{ file: "workspace://${id}" }] } };</script>`;

  it("serves audio-track references over the loopback server when available", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    workspaceFile("song.mp3", "audio/mpeg");
    // Stat-only gate: even a 40 MB track must not be read into the heap.
    mocks.resolveWorkspaceFile.mockReturnValue({
      exists: true,
      size: 40 * 1024 * 1024,
      bytes: async () => {
        throw new Error("bytes() must not be called on the served lane");
      },
    });

    const { html: out, audioFiles } = await inlineAudioAssets(
      schedule("song-1"),
      repository(),
    );

    expect(audioFiles).toEqual(["song.mp3"]);
    expect(out).not.toContain("workspace://");
    expect(out).not.toContain("data:audio");
    expect(out).toContain("http://127.0.0.1:9999/files/song-1/song.mp3");
  });

  it("falls back to data URIs when the server is unavailable", async () => {
    workspaceFile("song.mp3", "audio/mpeg");

    const { html: out, audioFiles } = await inlineAudioAssets(
      schedule("song-1"),
      repository(),
    );

    expect(audioFiles).toEqual(["song.mp3"]);
    expect(out).not.toContain("workspace://");
    expect(out).toContain("data:audio/mpeg;base64,");
  });

  it("returns the document untouched when there are no audio tracks", async () => {
    const { html: out, audioFiles } = await inlineAudioAssets(
      "<p>silent</p>",
      repository(),
    );

    expect(out).toBe("<p>silent</p>");
    expect(audioFiles).toEqual([]);
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it("fails clearly for missing or unavailable files", async () => {
    mocks.getById.mockResolvedValue(null);
    await expect(
      inlineAudioAssets(schedule("gone"), repository()),
    ).rejects.toThrow(/No workspace audio file found/);

    workspaceFile("gone.mp3", "audio/mpeg");
    mocks.exists = false;
    await expect(
      inlineAudioAssets(schedule("gone"), repository()),
    ).rejects.toThrow(/no longer available/);
  });

  it("fails fast on an over-budget file in either lane", async () => {
    // Served lane budgets at 200 MB; bytes() must never be called.
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    workspaceFile("huge.mp3", "audio/mpeg");
    mocks.resolveWorkspaceFile.mockReturnValue({
      exists: true,
      size: 300 * 1024 * 1024,
      bytes: async () => {
        throw new Error("bytes() must not be called for oversize audio");
      },
    });
    await expect(
      inlineAudioAssets(schedule("huge"), repository()),
    ).rejects.toThrow(/too large/);

    // Data-URI fallback rejects on the stat as well: a ~120 MB track must
    // never be materialized by bytes() (that read is what OOM'd the app —
    // the budget check has to run before the heap ever sees the file).
    serverMocks.baseUrl = null;
    workspaceFile("huge.mp3", "audio/mpeg");
    mocks.resolveWorkspaceFile.mockReturnValue({
      exists: true,
      size: 119 * 1024 * 1024,
      bytes: async () => {
        throw new Error("bytes() must not be called for oversize audio");
      },
    });
    await expect(
      inlineAudioAssets(schedule("huge"), repository()),
    ).rejects.toThrow(/Keep audio files under 15\.0 MB/);
  });

  /** Contract with a duration — the bound the WAV decode needs. */
  const scheduleWithDuration = (id: string, duration = 300) =>
    `<script>window.MOBILE_AGENT_VIDEO = { duration: ${duration}, audio: { tracks: [{ file: "workspace://${id}" }] } };</script>`;

  /** Served soundtrack carrying the uri the WAV lane reads. */
  function servedAudioFile() {
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "song.mp3",
      mimeType: "audio/mpeg",
      relativePath: `${id}/song.mp3`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 4 * 1024 * 1024,
      uri: "file:///workspace/song.mp3",
      bytes: async () => {
        throw new Error("bytes() must not be called on the served lane");
      },
    });
  }

  it("serves a cacheable WAV decode so segments can window it", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    servedAudioFile();
    nativeMocks.outExists = false;
    const decode = vi.fn(async () => ({ bytes: 1024 }));
    nativeMocks.decodeAudioWav = decode;

    const { html: out } = await inlineAudioAssets(
      scheduleWithDuration("song-1", 300),
      repository(),
    );

    expect(decode).toHaveBeenCalledTimes(1);
    const [inPath, outPath, maxSeconds] = decode.mock.calls[0] as unknown as [
      string,
      string,
      number,
    ];
    expect(inPath).toBe("/workspace/song.mp3");
    // Written partial, renamed only after the decode reports success.
    expect(outPath.endsWith(".wav.part")).toBe(true);
    expect(maxSeconds).toBe(300);
    expect(nativeMocks.moved).toEqual(["audio-pcm-song-1-4194304-300.wav"]);
    expect(out).toContain(
      "http://127.0.0.1:9999/cache/audio-pcm-song-1-4194304-300.wav",
    );
    expect(out).not.toContain("/files/");
    expect(out).not.toContain("data:audio");
  });

  it("streams the original soundtrack for a preview instead of decoding a WAV", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    servedAudioFile();
    nativeMocks.outExists = false;
    const decode = vi.fn(async () => ({ bytes: 1024 }));
    nativeMocks.decodeAudioWav = decode;

    const { html: out } = await inlineAudioAssets(
      scheduleWithDuration("song-1", 300),
      repository(),
      "preview",
    );

    expect(decode).not.toHaveBeenCalled();
    expect(out).toContain("http://127.0.0.1:9999/files/song-1/song.mp3");
    expect(out).not.toContain("/cache/audio-pcm-");
  });

  it("reuses a cached WAV without re-running the decode", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    servedAudioFile();
    const decode = vi.fn(async () => ({ bytes: 1024 }));
    nativeMocks.decodeAudioWav = decode;
    nativeMocks.outExists = true;

    const { html: out } = await inlineAudioAssets(
      scheduleWithDuration("song-1", 300),
      repository(),
    );

    expect(decode).not.toHaveBeenCalled();
    expect(nativeMocks.moved).toEqual([]);
    expect(out).toContain(
      "http://127.0.0.1:9999/cache/audio-pcm-song-1-4194304-300.wav",
    );
  });

  it("keeps the original soundtrack when the build predates the WAV op", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    servedAudioFile();
    nativeMocks.outExists = false;
    // nativeMocks.decodeAudioWav stays undefined: no op, no WAV lane.

    const { html: out } = await inlineAudioAssets(
      scheduleWithDuration("song-1", 300),
      repository(),
    );

    expect(out).toContain("http://127.0.0.1:9999/files/song-1/song.mp3");
    expect(out).not.toContain("/cache/audio-pcm-");
  });

  it("keeps the original soundtrack when the contract has no duration", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    servedAudioFile();
    nativeMocks.outExists = false;
    const decode = vi.fn(async () => ({ bytes: 1024 }));
    nativeMocks.decodeAudioWav = decode;

    // No duration means no sane decode bound: never decode, never cache.
    const { html: out } = await inlineAudioAssets(
      schedule("song-1"),
      repository(),
    );

    expect(decode).not.toHaveBeenCalled();
    expect(out).toContain("http://127.0.0.1:9999/files/song-1/song.mp3");
    expect(out).not.toContain("/cache/audio-pcm-");
  });

  it("serves the original soundtrack when the native decode fails", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    servedAudioFile();
    nativeMocks.outExists = false;
    nativeMocks.decodeAudioWav = vi.fn(async () => {
      throw new Error("The file has no audio track to decode.");
    });

    const { html: out } = await inlineAudioAssets(
      scheduleWithDuration("song-1", 300),
      repository(),
    );

    expect(out).toContain("http://127.0.0.1:9999/files/song-1/song.mp3");
    expect(out).not.toContain("/cache/audio-pcm-");
    expect(out).not.toContain("data:audio");
  });
});

describe("hasWorkspaceRefs", () => {
  it("detects image, clip, and audio-track references", () => {
    expect(hasWorkspaceRefs("<p>silent</p>")).toBe(false);
    expect(hasWorkspaceRefs(`<img src="workspace://pic-1">`)).toBe(true);
    expect(hasWorkspaceRefs(`<video src="workspace://clip-1"></video>`)).toBe(
      true,
    );
    expect(
      hasWorkspaceRefs(
        `<script>var s = { file: "workspace://song-1" };</script>`,
      ),
    ).toBe(true);
    expect(hasWorkspaceRefs(`<img src="https://example.com/x.png">`)).toBe(
      false,
    );
  });
});

describe("inlineVideoAssets served URLs", () => {
  it("preserves video CORS setup when the same MP4 is also scheduled as audio", async () => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    workspaceFile("original.mp4", "video/mp4");
    const source = `<video src="workspace://main"></video><script>var x={audio:{tracks:[{file:"workspace://main"}]}};</script>`;
    const audio = await inlineAudioAssets(source, repository());
    expect(audio.html).toContain('<video src="workspace://main">');
    const video = await inlineVideoAssets(audio.html, repository());
    expect(audio.audioFiles).toEqual(["original.mp4"]);
    expect(video.videoFiles).toEqual(["original.mp4"]);
    expect(video.html).toContain('crossorigin="anonymous"');
    expect(video.html).not.toContain("workspace://");
  });
  beforeEach(() => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
    nativeMocks.transcodeClip.mockReset();
    nativeMocks.transcodeClip.mockImplementation(async () => ({
      path: "/cache/clip-vid-1.mp4",
      width: 1280,
      height: 720,
      sizeBytes: 8_000_000,
    }));
    nativeMocks.outExists = false;
    nativeMocks.outBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18]);
    nativeMocks.deleted = [];
  });

  it("serves fitting clips by URL without reading bytes", async () => {
    let bytesRead = false;
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "clip.mp4",
      mimeType: "video/mp4",
      relativePath: `${id}/clip.mp4`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 8 * 1024 * 1024,
      uri: "file:///workspace/clip.mp4",
      bytes: async () => {
        bytesRead = true;
        return new Uint8Array([1, 2, 3]);
      },
    });
    const {
      html: out,
      videoFiles,
      warnings,
    } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );
    expect(bytesRead).toBe(false);
    expect(nativeMocks.transcodeClip).not.toHaveBeenCalled();
    expect(out).toContain("http://127.0.0.1:9999/files/vid-1/clip.mp4");
    expect(out).not.toContain("workspace://");
    expect(out).not.toContain("data:video");
    expect(videoFiles).toEqual(["clip.mp4"]);
    expect(warnings).toEqual([]);
  });

  it("serves large clips directly up to 1 GB with no transcode", async () => {
    bigWorkspaceFile("big-clip.mp4", "video/mp4", 800 * 1024 * 1024);
    const { html: out, warnings } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );
    expect(nativeMocks.transcodeClip).not.toHaveBeenCalled();
    expect(out).toContain("http://127.0.0.1:9999/files/vid-1/big-clip.mp4");
    expect(out).not.toContain("data:video");
    expect(warnings).toEqual([]);
  });

  it("serves transcoded output for absurd clips with a warning", async () => {
    bigWorkspaceFile("huge-clip.mp4", "video/mp4", 1100 * 1024 * 1024);
    const { html: out, warnings } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );
    expect(nativeMocks.transcodeClip).toHaveBeenCalledTimes(1);
    expect(out).toContain("http://127.0.0.1:9999/cache/");
    expect(out).not.toContain("data:video");
    expect(warnings).toHaveLength(1);
  });

  it("falls back to data URIs when the server is unavailable", async () => {
    serverMocks.baseUrl = null;
    workspaceFile("clip.mp4", "video/mp4");
    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );
    expect(out).toContain("data:video/mp4;base64,");
  });

  /** A served (non-transcode) clip with the uri + size the proxy lane reads. */
  function servedWorkspaceFile() {
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "clip.mp4",
      mimeType: "video/mp4",
      relativePath: `${id}/clip.mp4`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 8 * 1024 * 1024,
      uri: "file:///workspace/clip.mp4",
      bytes: async () => new Uint8Array([1, 2, 3]),
    });
  }

  it("never transcodes for a preview, even when the build can", async () => {
    servedWorkspaceFile();
    const makeProxy = vi.fn(async () => ({ allIntra: true }));
    nativeMocks.makeSeekProxy = makeProxy;

    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
      "preview",
    );

    // A proxy only changes seek cost; it must never delay opening a preview.
    expect(makeProxy).not.toHaveBeenCalled();
    expect(out).toContain("http://127.0.0.1:9999/files/vid-1/clip.mp4");
    expect(out).not.toContain("/cache/proxy-");
  });

  it("serves an all-keyframe seek proxy when the build can make one", async () => {
    servedWorkspaceFile();
    const makeProxy = vi.fn(async () => ({ allIntra: true }));
    nativeMocks.makeSeekProxy = makeProxy;

    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );

    expect(makeProxy).toHaveBeenCalledTimes(1);
    const [inPath, outPath, maxDim] = makeProxy.mock.calls[0] as unknown as [
      string,
      string,
      number,
    ];
    expect(inPath).toBe("/workspace/clip.mp4");
    // Written to a partial name, renamed only after the all-intra check, so
    // a kill mid-transcode can never leave a truncated file under a name a
    // later run would trust.
    expect(outPath.endsWith(".mp4.part")).toBe(true);
    expect(maxDim).toBe(1280);
    expect(nativeMocks.moved).toEqual(["proxy-vid-1-8388608-1280.mp4"]);
    expect(out).toContain(
      "http://127.0.0.1:9999/cache/proxy-vid-1-8388608-1280.mp4",
    );
    expect(out).not.toContain("/files/");
    expect(out).not.toContain("workspace://");
    expect(out).toContain('crossorigin="anonymous"');
  });

  it("serves the original clip when the encoder refuses all-intra", async () => {
    servedWorkspaceFile();
    nativeMocks.makeSeekProxy = vi.fn(async () => ({ allIntra: false }));

    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );

    expect(out).toContain("http://127.0.0.1:9999/files/vid-1/clip.mp4");
    expect(out).not.toContain("/cache/proxy-");
    // The verified-failed partial must not linger for a later run.
    expect(nativeMocks.deleted).toContain("proxy-vid-1-8388608-1280.mp4.part");
    expect(nativeMocks.moved).toEqual([]);
  });

  it("reuses a cached seek proxy without re-running the native op", async () => {
    servedWorkspaceFile();
    const makeProxy = vi.fn(async () => ({ allIntra: true }));
    nativeMocks.makeSeekProxy = makeProxy;
    // A verified proxy from an earlier run already sits in cache.
    nativeMocks.outExists = true;

    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );

    expect(makeProxy).not.toHaveBeenCalled();
    expect(nativeMocks.moved).toEqual([]);
    expect(out).toContain(
      "http://127.0.0.1:9999/cache/proxy-vid-1-8388608-1280.mp4",
    );
  });

  it("serves the original clip when the build predates the seek-proxy op", async () => {
    servedWorkspaceFile();
    // nativeMocks.makeSeekProxy stays undefined: no op, no proxy lane.

    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">`,
      repository(),
    );

    expect(out).toContain("http://127.0.0.1:9999/files/vid-1/clip.mp4");
    expect(out).not.toContain("/cache/proxy-");
  });

  it("caps the seek proxy at the contract canvas long edge", async () => {
    servedWorkspaceFile();
    const makeProxy = vi.fn(async () => ({ allIntra: true }));
    nativeMocks.makeSeekProxy = makeProxy;

    const { html: out } = await inlineVideoAssets(
      `<video src="workspace://vid-1">` +
        `<script>window.MOBILE_AGENT_VIDEO={duration:5,width:1080,height:1920};</script>`,
      repository(),
    );

    const [, , maxDim] = makeProxy.mock.calls[0] as unknown as [
      string,
      string,
      number,
    ];
    expect(maxDim).toBe(1920);
    expect(out).toContain(
      "http://127.0.0.1:9999/cache/proxy-vid-1-8388608-1920.mp4",
    );
  });
});

describe("inlineImageAssets served URLs", () => {
  beforeEach(() => {
    serverMocks.baseUrl = "http://127.0.0.1:9999";
  });

  afterEach(() => {
    serverMocks.baseUrl = null;
  });

  it("serves images by URL with cross-origin approval and never reads bytes", async () => {
    let bytesRead = false;
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "photo.png",
      mimeType: "image/png",
      relativePath: `${id}/photo.png`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 40 * 1024 * 1024,
      bytes: async () => {
        bytesRead = true;
        return new Uint8Array([1, 2, 3]);
      },
    });

    const { html: out, imageFiles } = await inlineImageAssets(
      `<img id="bg" src="workspace://img-1">`,
      repository(),
    );

    expect(bytesRead).toBe(false);
    expect(imageFiles).toEqual(["photo.png"]);
    expect(out).toContain('src="http://127.0.0.1:9999/files/img-1/photo.png"');
    // Without the attribute the export canvas would be tainted and
    // `toDataURL` would throw while capturing frames.
    expect(out).toMatch(/<img[^>]*crossorigin="anonymous"[^>]*>/);
    // The export loop awaits marked images and fails loud on decode failure.
    expect(out).toMatch(/<img[^>]*data-mobile-agent-asset="image"/);
    expect(out).not.toContain("data:image");
  });

  it("annotates a `<source>`-based video and leaves external media alone", async () => {
    mocks.getById.mockImplementation(async (id: string) => ({
      id,
      displayName: "clip.mp4",
      mimeType: "video/mp4",
      relativePath: `${id}/clip.mp4`,
    }));
    mocks.resolveWorkspaceFile.mockReturnValue({
      get exists() {
        return true;
      },
      size: 8 * 1024 * 1024,
      bytes: async () => new Uint8Array([1]),
    });

    const { html: out } = await inlineVideoAssets(
      `<video muted playsinline><source src="workspace://vid-1"></video><video src="https://example.com/x.mp4"></video>`,
      repository(),
    );

    expect(out).toContain("http://127.0.0.1:9999/files/vid-1/clip.mp4");
    const tags = out.match(/<video\b[^>]*>/gi) ?? [];
    expect(tags).toHaveLength(2);
    // The workspace clip (served via a child <source>) is CORS-approved…
    expect(tags[0]).toContain('crossorigin="anonymous"');
    // …while external media the scene author linked is left untouched.
    expect(tags[1]).not.toContain("crossorigin");
  });

  it("rejects a file over the 100 MB served budget without reading it", async () => {
    mocks.getById.mockResolvedValue({
      id: "img-1",
      displayName: "huge.png",
      mimeType: "image/png",
      relativePath: "img-1/huge.png",
    });
    mocks.resolveWorkspaceFile.mockReturnValue({
      exists: true,
      size: 150 * 1024 * 1024,
      bytes: async () => {
        throw new Error("bytes() must not be called for oversize images");
      },
    });

    await expect(
      inlineImageAssets(`<img src="workspace://img-1">`, repository()),
    ).rejects.toThrow(/Keep scene images under 100\.0 MB/);
  });

  it("keeps the 15 MB data-URI budget when the server is unavailable", async () => {
    serverMocks.baseUrl = null;
    mocks.getById.mockResolvedValue({
      id: "img-1",
      displayName: "photo.png",
      mimeType: "image/png",
      relativePath: "img-1/photo.png",
    });
    mocks.resolveWorkspaceFile.mockReturnValue({
      exists: true,
      size: 40 * 1024 * 1024,
      // The data-URI lane reads the file and budgets on the actual bytes.
      bytes: async () => new Uint8Array(16 * 1024 * 1024),
    });

    await expect(
      inlineImageAssets(`<img src="workspace://img-1">`, repository()),
    ).rejects.toThrow(/Keep scene images under 15\.0 MB/);
  });

  it("falls back to data URIs with no CORS attribute when the server is unavailable", async () => {
    serverMocks.baseUrl = null;
    workspaceFile("photo.png", "image/png");

    const { html: out } = await inlineImageAssets(
      `<img src="workspace://img-1">`,
      repository(),
    );

    expect(out).toContain("data:image/png;base64,");
    // Marked for the exporter's loud decode guard even on the fallback lane.
    expect(out).toMatch(/<img[^>]*data-mobile-agent-asset="image"/);
    expect(out).not.toContain("crossorigin");
  });
});
