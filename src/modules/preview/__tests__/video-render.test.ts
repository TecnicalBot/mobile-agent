import { describe, expect, it, vi } from "vitest";

import {
  hasVideoRenderHost,
  normalizeVideoPlan,
  probeVideoPlan,
  requestVideoRender,
  subscribeVideoRender,
  type VideoJob,
} from "@/modules/preview/video-render";

const CONTRACT_HTML =
  '<html><script>window.MOBILE_AGENT_VIDEO = { duration: 1, render: function () {} };</script></html>';

describe("requestVideoRender", () => {
  it("rejects documents that do not implement the contract", async () => {
    const unsubscribe = subscribeVideoRender(() => {});
    await expect(requestVideoRender("<html></html>")).rejects.toThrow(
      /MOBILE_AGENT_VIDEO/,
    );
    unsubscribe();
  });

  it("rejects when no host is registered", async () => {
    expect(hasVideoRenderHost()).toBe(false);
    await expect(requestVideoRender(CONTRACT_HTML)).rejects.toThrow(
      /only available on Android/,
    );
  });

  it("hands the job to a subscriber and resolves with its result", async () => {
    const listener = vi.fn((job: VideoJob) => {
      if (job.kind !== "render") throw new Error("expected a render job");
      job.resolve({ uri: "file:///cache/v.mp4", sizeBytes: 42, hasAudio: false, audioWarnings: [] });
    });
    const unsubscribe = subscribeVideoRender(listener);

    const result = await requestVideoRender(CONTRACT_HTML);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ uri: "file:///cache/v.mp4", sizeBytes: 42, hasAudio: false, audioWarnings: [] });

    unsubscribe();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const unsubscribe = subscribeVideoRender(() => {});
    const controller = new AbortController();
    controller.abort();

    await expect(
      requestVideoRender(CONTRACT_HTML, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);

    unsubscribe();
  });

  it("stops notifying unsubscribed listeners", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVideoRender(listener);
    unsubscribe();

    await expect(requestVideoRender(CONTRACT_HTML)).rejects.toThrow(
      /only available on Android/,
    );
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("probeVideoPlan", () => {
  const PLAN = {
    duration: 20,
    fps: 30,
    width: 1280,
    height: 720,
    sharedHash: "h-shared",
    shots: [{ id: "intro", start: 0, end: 10, hash: "h-shot" }],
  };

  it("rejects documents without the contract", async () => {
    const unsubscribe = subscribeVideoRender(() => {});
    await expect(probeVideoPlan("<html></html>")).rejects.toThrow(
      /MOBILE_AGENT_VIDEO/,
    );
    unsubscribe();
  });

  it("queues a probe job and resolves with the page plan", async () => {
    const listener = vi.fn((job: VideoJob) => {
      if (job.kind !== "probe") throw new Error("expected a probe job");
      job.resolve(PLAN);
    });
    const unsubscribe = subscribeVideoRender(listener);

    await expect(probeVideoPlan(CONTRACT_HTML)).resolves.toEqual(PLAN);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const unsubscribe = subscribeVideoRender(() => {});
    const controller = new AbortController();
    controller.abort();

    await expect(
      probeVideoPlan(CONTRACT_HTML, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);

    unsubscribe();
  });
});

describe("normalizeVideoPlan", () => {
  it("accepts a well-formed plan and sorts shots by time", () => {
    expect(
      normalizeVideoPlan({
        duration: 20,
        fps: 30,
        width: 1280,
        height: 720,
        sharedHash: "h-shared",
        shots: [
          { id: "b", start: 10, end: 20, hash: "h2" },
          { id: "a", start: 0, end: 10, hash: "h1" },
        ],
      }),
    ).toMatchObject({
      shots: [
        { id: "a", start: 0, end: 10 },
        { id: "b", start: 10, end: 20 },
      ],
    });
  });

  it("rejects plans missing the shared hash or timing", () => {
    expect(normalizeVideoPlan(null)).toBeNull();
    expect(normalizeVideoPlan({ duration: 20, fps: 30, width: 1280, height: 720 })).toBeNull();
    expect(
      normalizeVideoPlan({ duration: 0, fps: 30, width: 1280, height: 720, sharedHash: "h" }),
    ).toBeNull();
  });

  it("drops invalid shot entries instead of failing the plan", () => {
    expect(
      normalizeVideoPlan({
        duration: 20,
        fps: 30,
        width: 1280,
        height: 720,
        sharedHash: "h",
        shots: [
          { id: "ok", start: 0, end: 5, hash: "h1" },
          { id: "reversed", start: 9, end: 3, hash: "h2" },
          { id: "no-hash", start: 5, end: 9 },
        ],
      })?.shots,
    ).toEqual([{ id: "ok", start: 0, end: 5, hash: "h1" }]);
  });
});
