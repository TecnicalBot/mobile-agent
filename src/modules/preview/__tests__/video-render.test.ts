import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasVideoRenderHost,
  getVideoRenderStatus,
  getVideoRenderStatusForConversation,
  normalizeVideoPlan,
  probeVideoPlan,
  requestVideoRender,
  setVideoRenderStatus,
  subscribeVideoRender,
  subscribeVideoRenderStatus,
  type VideoJob,
} from "@/modules/preview/video-render";

const CONTRACT_HTML =
  "<html><script>window.MOBILE_AGENT_VIDEO = { duration: 1, render: function () {} };</script></html>";

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
      job.resolve({
        uri: "file:///cache/v.mp4",
        sizeBytes: 42,
        hasAudio: false,
        audioWarnings: [],
      });
    });
    const unsubscribe = subscribeVideoRender(listener);

    const result = await requestVideoRender(CONTRACT_HTML);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      uri: "file:///cache/v.mp4",
      sizeBytes: 42,
      hasAudio: false,
      audioWarnings: [],
    });

    unsubscribe();
  });

  it("keeps the owning conversation on the queued job", async () => {
    const unsubscribe = subscribeVideoRender((job) => {
      if (job.kind !== "render") throw new Error("expected a render job");
      expect(job.conversationId).toBe("chat-a");
      job.resolve({
        uri: "file:///cache/v.mp4",
        sizeBytes: 42,
        hasAudio: false,
        audioWarnings: [],
      });
    });
    try {
      await requestVideoRender(CONTRACT_HTML, { conversationId: "chat-a" });
    } finally {
      unsubscribe();
    }
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

describe("conversation-scoped video progress", () => {
  afterEach(() => setVideoRenderStatus(null));

  it("shows progress only in the owning chat while preserving the global lock", () => {
    const status = {
      conversationId: "chat-a",
      progress: 0.42,
      finishing: false,
    };
    setVideoRenderStatus(status);
    expect(getVideoRenderStatusForConversation("chat-a")).toBe(status);
    expect(getVideoRenderStatusForConversation("chat-b")).toBeNull();
    expect(getVideoRenderStatus()).toBe(status);

    setVideoRenderStatus({ ...status, progress: 0.99, finishing: true });
    expect(getVideoRenderStatusForConversation("chat-a")?.finishing).toBe(true);
    expect(getVideoRenderStatusForConversation("chat-b")).toBeNull();
    setVideoRenderStatus(null);
    expect(getVideoRenderStatusForConversation("chat-a")).toBeNull();
  });

  it("does not attribute a manual or bridge export to any chat", () => {
    setVideoRenderStatus({ progress: 0.5, finishing: false });
    expect(getVideoRenderStatus()).not.toBeNull();
    expect(getVideoRenderStatusForConversation("chat-a")).toBeNull();
    expect(getVideoRenderStatusForConversation("chat-b")).toBeNull();
  });

  it("notifies subscribers as ownership changes between queued chats", () => {
    const observed: (number | undefined)[] = [];
    const unsubscribe = subscribeVideoRenderStatus(() => {
      observed.push(getVideoRenderStatusForConversation("chat-b")?.progress);
    });
    try {
      setVideoRenderStatus({
        conversationId: "chat-a",
        progress: 0.5,
        finishing: false,
      });
      setVideoRenderStatus(null);
      setVideoRenderStatus({
        conversationId: "chat-b",
        progress: 0,
        finishing: false,
      });
      setVideoRenderStatus({
        conversationId: "chat-b",
        progress: 0.25,
        finishing: false,
      });
      setVideoRenderStatus(null);
      expect(observed).toEqual([undefined, undefined, 0, 0.25, undefined]);
    } finally {
      unsubscribe();
    }
  });

  it("scopes streaming rows to their message's chat instead of the visible chat", () => {
    const source = readFileSync(
      new URL("../../../components/ui/chat-message.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("conversationId={message.conversationId}");
    expect(source).toContain(
      "getVideoRenderStatusForConversation(conversationId)",
    );
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
    expect(
      normalizeVideoPlan({ duration: 20, fps: 30, width: 1280, height: 720 }),
    ).toBeNull();
    expect(
      normalizeVideoPlan({
        duration: 0,
        fps: 30,
        width: 1280,
        height: 720,
        sharedHash: "h",
      }),
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

  it("normalizes declared editor layers and clip windows", () => {
    const plan = normalizeVideoPlan({
      duration: 10,
      fps: 30,
      width: 1280,
      height: 720,
      sharedHash: "h",
      shots: [{ id: "only", start: 0, end: 10, hash: "h1" }],
      layers: [
        {
          type: "text",
          text: "Hello",
          start: 0,
          end: 4,
          x: 10,
          y: 20,
          w: 300,
          h: 80,
          fontSize: 72,
          color: "#fff",
          align: "center",
          z: 3,
          keys: [
            { t: 0.5, opacity: 0.2 },
            { t: 0, opacity: 0 },
          ],
        },
        {
          type: "image",
          start: 4,
          end: 9,
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          fileId: "img-1",
          fit: "fit",
        },
        // Dropped: an image layer without a source file.
        { type: "image", start: 0, end: 1, x: 0, y: 0, w: 10, h: 10 },
        // Dropped: inverted window.
        { type: "shape", start: 5, end: 2, x: 0, y: 0, w: 10, h: 10 },
        // Dropped: unknown type.
        { type: "audio", start: 0, end: 1 },
      ],
      clipLayers: [
        { id: "a", label: "A", start: 0, end: 5, from: 1, fileId: "vid-a" },
        {
          id: "b",
          start: 6,
          end: 9,
          from: 0,
          x: 10,
          y: 20,
          w: 100,
          h: 50,
          alpha: 0.5,
        },
        // Dropped: inverted window.
        { id: "bad", start: 8, end: 4 },
      ],
    });

    expect(plan?.layers).toHaveLength(2);
    const text = plan!.layers![0];
    expect(text).toMatchObject({
      type: "text",
      text: "Hello",
      start: 0,
      end: 4,
      x: 10,
      y: 20,
      w: 300,
      h: 80,
      fontSize: 72,
      align: "center",
      z: 3,
      opacity: 1,
    });
    expect(text.keys).toEqual([
      { t: 0, opacity: 0 },
      { t: 0.5, opacity: 0.2 },
    ]);
    expect(plan!.layers![1]).toMatchObject({
      type: "image",
      fileId: "img-1",
      fit: "fit",
    });

    expect(plan?.clipLayers).toHaveLength(2);
    expect(plan!.clipLayers![0]).toMatchObject({
      id: "a",
      start: 0,
      end: 5,
      from: 1,
      fileId: "vid-a",
    });
    expect(plan!.clipLayers![1]).toMatchObject({
      id: "b",
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      opacity: 0.5,
    });
  });

  it("omits layer arrays when the scene declares none", () => {
    const plan = normalizeVideoPlan({
      duration: 10,
      fps: 30,
      width: 1280,
      height: 720,
      sharedHash: "h",
      shots: [{ id: "only", start: 0, end: 10, hash: "h1" }],
    });
    expect(plan?.layers).toEqual([]);
    expect(plan?.clipLayers).toEqual([]);
  });
});
