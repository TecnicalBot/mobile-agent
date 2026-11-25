import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRemoteRenderBackend } from "@/modules/preview/remote-render-backend";

const mocks = vi.hoisted(() => ({
  writes: new Map<string, Uint8Array>(),
  fetch: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache" } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    write(bytes: Uint8Array) {
      mocks.writes.set(this.uri, bytes);
    }
  },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    encoders: ["h264_nvenc"],
    preferred: "h264_nvenc",
    hardware: true,
    gpu: { vendor: "nvidia", name: "RTX 5060" },
    canvas: "gpu",
    ...overrides,
  };
}

async function makeBackend() {
  mocks.fetch.mockResolvedValueOnce(json(capabilities()));
  return createRemoteRenderBackend({
    baseUrl: "http://node:8787/",
    token: "secret",
    concurrency: 4,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.clear();
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("createRemoteRenderBackend", () => {
  it("refuses a software-only node", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(capabilities({ encoders: ["libx264"], preferred: "libx264", hardware: false, gpu: undefined })),
    );

    await expect(
      createRemoteRenderBackend({ baseUrl: "http://node:8787" }),
    ).rejects.toThrow(/no hardware encoder/);
  });

  it("reports an unreachable node with the address and a next step", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      createRemoteRenderBackend({ baseUrl: "http://node:8787" }),
    ).rejects.toThrow(/Could not reach the render node at http:\/\/node:8787/);
  });

  it("sends the bearer token and builds a profile from the proven encoder", async () => {
    const backend = await makeBackend();

    const request = mocks.fetch.mock.calls[0];
    expect(request[0]).toBe("http://node:8787/v1/capabilities");
    expect(request[1].headers).toEqual({ authorization: "Bearer secret" });

    expect(backend.kind).toBe("remote");
    expect(backend.concurrency).toBe(4);
    expect(backend.profileFor({ width: 1920, height: 1080, fps: 30 }).id).toBe(
      "h264_nvenc-1920x1080-30-yuv420p",
    );
  });

  it("probes the page and returns its plan", async () => {
    const backend = await makeBackend();
    const plan = {
      duration: 12,
      fps: 30,
      width: 1280,
      height: 720,
      sharedHash: "h1234abcd",
      shots: [],
    };
    mocks.fetch.mockResolvedValueOnce(json(plan));

    await expect(backend.probe("<html></html>")).resolves.toEqual(plan);
    const [, init] = mocks.fetch.mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ html: "<html></html>" });
  });

  it("renders a segment into the cache and reports the encoder", async () => {
    const backend = await makeBackend();
    const progress: number[] = [];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mocks.fetch.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } }),
    );

    const result = await backend.renderSegment({
      documentHtml: "<html></html>",
      segment: { offset: 45, length: 45 },
      pinnedEncoder: "h264_nvenc",
      onProgress: (fraction) => progress.push(fraction),
    });

    const [, init] = mocks.fetch.mock.calls[1];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      html: "<html></html>",
      offset: 45,
      length: 45,
      encoder: "h264_nvenc",
    });
    expect(typeof body.jobId).toBe("string");

    expect(result.encoder).toBe("h264_nvenc");
    expect(result.hasAudio).toBe(false);
    expect(result.uri).toContain("file:///cache/remote-job-");
    expect([...mocks.writes.values()][0]).toEqual(bytes);
    expect(progress).toEqual([0, 1]);
  });

  it("surfaces the node's refusal text", async () => {
    const backend = await makeBackend();
    mocks.fetch.mockResolvedValueOnce(
      json({ error: "Audio schedules are not supported by this render node yet" }, 500),
    );

    await expect(
      backend.renderSegment({ documentHtml: "<html></html>", segment: { offset: 0, length: 10 } }),
    ).rejects.toThrow(/Audio schedules are not supported by this render node yet/);
    expect(mocks.writes.size).toBe(0);
  });

  it("cancels the node job when the caller aborts", async () => {
    const backend = await makeBackend();
    const controller = new AbortController();
    controller.abort();

    mocks.fetch.mockImplementation((url: string) => {
      if (url.includes("/v1/jobs/")) return Promise.resolve(json({ cancelled: true }));
      return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });

    await expect(
      backend.renderSegment({
        documentHtml: "<html></html>",
        segment: { offset: 0, length: 10 },
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);

    // The HTTP abort alone does not kill ffmpeg; the explicit DELETE does.
    const cancelCall = mocks.fetch.mock.calls.find(([url]) =>
      String(url).includes("/v1/jobs/"),
    );
    expect(cancelCall).toBeTruthy();
    expect(cancelCall?.[1]?.method).toBe("DELETE");
    expect(mocks.writes.size).toBe(0);
  });
});
