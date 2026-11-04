import { afterEach, describe, expect, it, vi } from "vitest";

const {
  VIDEO_PREVIEW_SCRIPT,
  buildScenePreviewDocument,
} = await import("@/modules/preview/video-preview-script");

type Posted = { type: string; [key: string]: unknown };

type FakeCanvas = {
  width: number;
  height: number;
  getContext: () => object;
  toDataURL: () => string;
};

function installDom(options: {
  render?: (t: number) => void;
  shots?: { id: string; start: number; end: number; render: (t: number) => void }[];
  images?: { complete: boolean; naturalWidth: number }[];
  videos?: { readyState: number; error?: object | null }[];
  toDataURL?: () => string;
} = {}) {
  const g = globalThis as Record<string, unknown>;
  const messages: Posted[] = [];
  const renderCalls: number[] = [];

  const canvas: FakeCanvas = {
    width: 1280,
    height: 720,
    getContext: () => ({}),
    toDataURL: options.toDataURL ?? (() => "data:image/jpeg;base64,QUJD"),
  };

  const videos = (options.videos ?? []).map((v) => ({
    readyState: v.readyState,
    error: v.error ?? null,
    muted: false,
    paused: false,
    pause() {
      this.paused = true;
    },
  }));

  g.window = {
    MOBILE_AGENT_VIDEO: {
      duration: 2,
      render: (t: number) => {
        renderCalls.push(t);
        options.render?.(t);
      },
      ...(options.shots ? { shots: options.shots } : {}),
    },
    ReactNativeWebView: {
      postMessage: (data: string) => {
        messages.push(JSON.parse(data));
      },
    },
    __mobileAgentScenePreviewConfig: { settleMs: 5, readyTimeoutMs: 60 },
  };
  g.document = {
    getElementById: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === "canvas") return [canvas];
      if (selector === "video") return videos;
      return [];
    },
    images: options.images ?? [],
  };

  new Function(VIDEO_PREVIEW_SCRIPT)();

  const w = g.window as Record<string, (times: number[]) => void>;
  return {
    messages,
    renderCalls,
    videos,
    start: (times: number[]) => w.__startMobileAgentScenePreview(times),
    cancel: () =>
      (w as Record<string, () => void>).__cancelMobileAgentScenePreview(),
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  vi.unstubAllGlobals();
});

async function waitForDone(messages: Posted[]) {
  await vi.waitFor(
    () => {
      expect(
        messages.some((m) => m.type === "mobileAgentPreviewDone"),
      ).toBe(true);
    },
    { timeout: 4000 },
  );
}

function doneWarnings(messages: Posted[]): string[] {
  const done = messages.find((m) => m.type === "mobileAgentPreviewDone") as
    | { warnings?: unknown }
    | undefined;
  return Array.isArray(done?.warnings) ? (done.warnings as string[]) : [];
}

describe("VIDEO_PREVIEW_SCRIPT", () => {
  it("runs the shot that owns each storyboard timestamp", async () => {
    const first: number[] = [];
    const second: number[] = [];
    const api = installDom({
      shots: [
        { id: "a", start: 0, end: 1, render: (t) => first.push(t) },
        { id: "b", start: 1, end: 2, render: (t) => second.push(t) },
      ],
    });

    api.start([0.5, 1.5]);
    await waitForDone(api.messages);

    // Two passes per still, like the top-level render path.
    expect(first).toEqual([0.5, 0.5]);
    expect(second).toEqual([1.5, 1.5]);
    expect(api.renderCalls).toEqual([]);
  });

  it("captures one frame per timestamp with two render passes each", async () => {
    const api = installDom();
    api.start([0, 1.5]);
    await waitForDone(api.messages);

    const frames = api.messages.filter(
      (m) => m.type === "mobileAgentPreviewFrame",
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      frame: { time: 0, width: 1280, height: 720, base64: "QUJD" },
    });
    expect(frames[1]).toMatchObject({ frame: { time: 1.5 } });
    // Settle pass + capture pass per timestamp.
    expect(api.renderCalls).toEqual([0, 0, 1.5, 1.5]);
  }, 10000);

  it("mutes and pauses videos while capturing", async () => {
    const { messages, videos } = installDom({
      videos: [{ readyState: 4 }],
    });
    const w = (globalThis as Record<string, unknown>).window as Record<
      string,
      (times: number[]) => void
    >;
    w.__startMobileAgentScenePreview([0]);
    await waitForDone(messages);

    expect(videos[0].muted).toBe(true);
    expect(videos[0].paused).toBe(true);
    expect(
      messages.filter((m) => m.type === "mobileAgentPreviewFrame"),
    ).toHaveLength(1);
  }, 10000);

  it("warns about broken images but still captures", async () => {
    const { messages } = installDom({
      images: [{ complete: true, naturalWidth: 0 }],
    });
    const w = (globalThis as Record<string, unknown>).window as Record<
      string,
      (times: number[]) => void
    >;
    w.__startMobileAgentScenePreview([0]);
    await waitForDone(messages);

    expect(doneWarnings(messages).some((msg) => msg.includes("image"))).toBe(
      true,
    );
    expect(
      messages.filter((m) => m.type === "mobileAgentPreviewFrame"),
    ).toHaveLength(1);
  }, 10000);

  it("reports a tainted canvas instead of hanging", async () => {
    const { messages } = installDom({
      toDataURL: () => {
        throw new DOMException("tainted", "SecurityError");
      },
    });
    const w = (globalThis as Record<string, unknown>).window as Record<
      string,
      (times: number[]) => void
    >;
    w.__startMobileAgentScenePreview([0, 1]);
    await waitForDone(messages);

    expect(
      messages.filter((m) => m.type === "mobileAgentPreviewFrame"),
    ).toHaveLength(0);
    expect(doneWarnings(messages).some((msg) => msg.includes("tainted"))).toBe(
      true,
    );
  }, 10000);

  it("records a render throw and continues with other timestamps", async () => {
    const { messages } = installDom({
      render: (t) => {
        if (t === 1) throw new Error("boom");
      },
    });
    const w = (globalThis as Record<string, unknown>).window as Record<
      string,
      (times: number[]) => void
    >;
    w.__startMobileAgentScenePreview([0, 1]);
    await waitForDone(messages);

    const frames = messages.filter(
      (m) => m.type === "mobileAgentPreviewFrame",
    );
    expect(frames).toHaveLength(1);
    expect(doneWarnings(messages).some((msg) => msg.includes("boom"))).toBe(
      true,
    );
  }, 10000);

  it("posts nothing after cancel", async () => {
    const { messages, cancel, start } = installDom();
    start([0, 1]);
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(messages).toEqual([{ type: "mobileAgentPreviewStarted" }]);
  }, 10000);

  it("acknowledges startup before media is ready", async () => {
    const api = installDom({ videos: [{ readyState: 0 }] });
    api.start([0]);
    expect(api.messages).toEqual([{ type: "mobileAgentPreviewStarted" }]);
    await waitForDone(api.messages);
  });

  it("reports unexpected media setup errors instead of leaving a pending job", async () => {
    const api = installDom();
    Object.defineProperty((globalThis as any).document, "images", {
      get() { throw new Error("media failed"); },
    });
    api.start([0]);
    await vi.waitFor(() => expect(api.messages).toContainEqual({
      type: "mobileAgentPreviewError",
      message: "Scene preview failed: media failed",
    }));
  });
});

describe("buildScenePreviewDocument", () => {
  it("injects the runner before </body>", () => {
    const out = buildScenePreviewDocument(
      "<html><body><canvas></canvas></body></html>",
    );
    expect(out).toContain("__startMobileAgentScenePreview");
    // The storyboard is the chroma tuning loop, so the keyer must ride along.
    expect(out).toContain("__mobileAgentChromaKey");
    expect(out.indexOf("__startMobileAgentScenePreview")).toBeLessThan(
      out.indexOf("</body>"),
    );
  });

  it("appends the runner when there is no body", () => {
    const out = buildScenePreviewDocument("<html><canvas></canvas></html>");
    expect(out).toContain("__startMobileAgentScenePreview");
  });
});
