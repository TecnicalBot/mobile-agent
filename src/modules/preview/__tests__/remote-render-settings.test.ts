import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMOTE_RENDER_SETTINGS,
  MAX_REMOTE_RENDER_CONCURRENCY,
  normalizeRemoteRenderBaseUrl,
  normalizeRemoteRenderSettings,
} from "@/modules/preview/remote-render-settings";

describe("normalizeRemoteRenderBaseUrl", () => {
  it("keeps a full http(s) URL and drops trailing slashes", () => {
    expect(normalizeRemoteRenderBaseUrl(" http://192.168.1.20:8787/ ")).toBe(
      "http://192.168.1.20:8787",
    );
    expect(normalizeRemoteRenderBaseUrl("https://render.example.com")).toBe(
      "https://render.example.com",
    );
  });

  it("accepts a pasted /v1 endpoint path", () => {
    expect(
      normalizeRemoteRenderBaseUrl("http://192.168.1.20:8787/v1/"),
    ).toBe("http://192.168.1.20:8787");
  });

  it("rejects empty input and non-http schemes", () => {
    expect(normalizeRemoteRenderBaseUrl("")).toBeNull();
    expect(normalizeRemoteRenderBaseUrl("   ")).toBeNull();
    expect(normalizeRemoteRenderBaseUrl(null)).toBeNull();
    expect(normalizeRemoteRenderBaseUrl("ftp://host:21")).toBeNull();
    expect(normalizeRemoteRenderBaseUrl("not a url")).toBeNull();
  });
});

describe("normalizeRemoteRenderSettings", () => {
  it("defaults to off, even when a URL is stored", () => {
    expect(normalizeRemoteRenderSettings()).toEqual(
      DEFAULT_REMOTE_RENDER_SETTINGS,
    );
    expect(
      normalizeRemoteRenderSettings({ baseUrl: "http://host:8787" }).enabled,
    ).toBe(false);
  });

  it("treats enabled-without-a-usable-URL as off", () => {
    expect(
      normalizeRemoteRenderSettings({ enabled: true, baseUrl: "nonsense" }),
    ).toEqual({
      enabled: false,
      baseUrl: null,
      concurrency: DEFAULT_REMOTE_RENDER_SETTINGS.concurrency,
    });
  });

  it("clamps concurrency and rounds fractional values", () => {
    expect(normalizeRemoteRenderSettings({ concurrency: 0 }).concurrency).toBe(1);
    expect(normalizeRemoteRenderSettings({ concurrency: 99 }).concurrency).toBe(
      MAX_REMOTE_RENDER_CONCURRENCY,
    );
    expect(normalizeRemoteRenderSettings({ concurrency: 3.6 }).concurrency).toBe(4);
    expect(
      normalizeRemoteRenderSettings({ concurrency: Number.NaN }).concurrency,
    ).toBe(DEFAULT_REMOTE_RENDER_SETTINGS.concurrency);
  });
});
