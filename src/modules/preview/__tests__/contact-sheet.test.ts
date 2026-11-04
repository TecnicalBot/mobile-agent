import { describe, expect, it, vi } from "vitest";
import { buildContactSheetDocument, createContactSheet } from "@/modules/preview/contact-sheet";
import { subscribeScenePreview } from "@/modules/preview/video-preview";

const frame = { time: 2.5, width: 1280, height: 720, base64: "QUJD" };

describe("contact sheets", () => {
  it("bounds twelve frames to 1280x804 and labels each timestamp", () => {
    const doc = buildContactSheetDocument(Array.from({ length: 12 }, (_, time) => ({ ...frame, time })));
    expect(doc).toContain('width="1280" height="804"');
    expect(doc).toContain("'12. 11s'");
    expect(doc.match(/<img /g)).toHaveLength(12);
  });

  it("contains portrait and landscape frames without stretching", () => {
    const doc = buildContactSheetDocument([frame, { ...frame, time: 5 }]);
    const script = doc.match(/<script>([\s\S]*)<\/script>/)![1];
    const images = [{ complete: true, naturalWidth: 1280, naturalHeight: 720 }, { complete: true, naturalWidth: 720, naturalHeight: 1280 }];
    const window: any = {};
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() };
    new Function("window", "document", script)(window, { getElementById: (id: string) => images[Number(id.slice(1))] });
    window.MOBILE_AGENT_VIDEO.render(0, { width: 640, height: 268 }, ctx);
    expect(ctx.drawImage.mock.calls[0].slice(3)).toEqual([320, 180]);
    expect(ctx.drawImage.mock.calls[1].slice(3)).toEqual([135, 240]);
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual(["1. 2.5s", "2. 5s"]);
  });

  it("rejects invalid inputs instead of injecting them into HTML", () => {
    expect(() => buildContactSheetDocument([])).toThrow();
    expect(() => buildContactSheetDocument(Array(13).fill(frame))).toThrow();
    expect(() => buildContactSheetDocument([{ ...frame, base64: '</script>' }])).toThrow();
    expect(() => buildContactSheetDocument([{ ...frame, time: NaN }])).toThrow();
  });

  it("uses one preview job and propagates failed captures", async () => {
    const stop = subscribeScenePreview((job) => job.resolve({ frames: [], warnings: ["decode failed"] }));
    try {
      await expect(createContactSheet([frame])).rejects.toThrow(/decode failed/);
    } finally { stop(); }
  });
});
