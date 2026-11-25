import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigRepository } from "@/core/db/repositories/types";
import {
  renderVideoWithResolvedBackend,
  resolveRenderBackend,
} from "@/modules/preview/render-backend-resolution";

const mocks = vi.hoisted(() => ({
  createDevice: vi.fn(),
  createRemote: vi.fn(),
  getRemoteRenderToken: vi.fn(),
  getSettings: vi.fn(),
  renderSegments: vi.fn(),
}));

vi.mock("@/modules/preview/render-backend", () => ({
  createDeviceRenderBackend: mocks.createDevice,
}));

vi.mock("@/modules/preview/remote-render-backend", () => ({
  createRemoteRenderBackend: mocks.createRemote,
}));

vi.mock("@/modules/preview/render-segments", () => ({
  renderSegments: mocks.renderSegments,
}));

vi.mock("@/core/services/secrets", () => ({
  secureSecretStore: {
    getRemoteRenderToken: mocks.getRemoteRenderToken,
  },
}));

const deviceBackend = { id: "device", kind: "device", concurrency: 1 };
const remoteBackend = { id: "remote", kind: "remote", concurrency: 4 };

const configRepository = {
  getSettings: mocks.getSettings,
} as unknown as ConfigRepository;

function settings(remoteRender: {
  enabled: boolean;
  baseUrl: string | null;
  concurrency?: number;
}) {
  return {
    remoteRender: {
      enabled: remoteRender.enabled,
      baseUrl: remoteRender.baseUrl,
      concurrency: remoteRender.concurrency ?? 4,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDevice.mockReturnValue(deviceBackend);
  mocks.createRemote.mockResolvedValue(remoteBackend);
  mocks.getRemoteRenderToken.mockResolvedValue("secret");
});

describe("resolveRenderBackend", () => {
  it("uses the device when no settings store is available", async () => {
    const result = await resolveRenderBackend();

    expect(result.backend).toBe(deviceBackend);
    expect(result.warning).toBeUndefined();
    expect(mocks.createRemote).not.toHaveBeenCalled();
  });

  it("uses the device when remote rendering is disabled", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: false, baseUrl: "http://node:8787" }),
    );

    const result = await resolveRenderBackend({ configRepository });

    expect(result.backend).toBe(deviceBackend);
    expect(mocks.createRemote).not.toHaveBeenCalled();
  });

  it("resolves the remote node with the stored token", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: true, baseUrl: "http://node:8787", concurrency: 6 }),
    );

    const result = await resolveRenderBackend({
      configRepository,
      secretStore: { getRemoteRenderToken: mocks.getRemoteRenderToken },
    });

    expect(result.backend).toBe(remoteBackend);
    expect(result.warning).toBeUndefined();
    expect(mocks.createRemote).toHaveBeenCalledWith({
      baseUrl: "http://node:8787",
      token: "secret",
      concurrency: 6,
    });
  });

  it("falls back to the device with a warning when the node is unusable", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: true, baseUrl: "http://node:8787" }),
    );
    mocks.createRemote.mockRejectedValue(
      new Error("The render target reports no hardware encoder"),
    );

    const result = await resolveRenderBackend({ configRepository });

    expect(result.backend).toBe(deviceBackend);
    expect(result.warning).toContain("http://node:8787");
    expect(result.warning).toContain("no hardware encoder");
    expect(result.warning).toContain("Rendered on this device");
  });

  it("falls back to the device when the setting cannot be read", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db closed"));

    const result = await resolveRenderBackend({ configRepository });

    expect(result.backend).toBe(deviceBackend);
    expect(result.warning).toContain("Could not read the video rendering setting");
  });
});

describe("renderVideoWithResolvedBackend", () => {
  const options = {
    contractDuration: 10,
    documentHtml: "<html></html>",
    sourceFileId: "h1234",
  };

  it("renders remotely and returns no warning", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: true, baseUrl: "http://node:8787" }),
    );
    mocks.renderSegments.mockResolvedValue({ uri: "file:///cache/out.mp4" });

    const outcome = await renderVideoWithResolvedBackend(options, {
      configRepository,
    });

    expect(outcome.result).toEqual({ uri: "file:///cache/out.mp4" });
    expect(outcome.warning).toBeUndefined();
    expect(mocks.renderSegments).toHaveBeenCalledTimes(1);
    expect(mocks.renderSegments.mock.calls[0][0].backend).toBe(remoteBackend);
  });

  it("retries once on the device when the node cannot render the scene", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: true, baseUrl: "http://node:8787" }),
    );
    mocks.renderSegments
      .mockRejectedValueOnce(
        new Error(
          "Audio schedules are not supported by this render node yet (v1 renders silent video only).",
        ),
      )
      .mockResolvedValueOnce({ uri: "file:///cache/device.mp4" });

    const outcome = await renderVideoWithResolvedBackend(options, {
      configRepository,
    });

    expect(outcome.result).toEqual({ uri: "file:///cache/device.mp4" });
    expect(outcome.warning).toContain("Rendered on this device instead");
    expect(mocks.renderSegments).toHaveBeenCalledTimes(2);
    expect(mocks.renderSegments.mock.calls[1][0].backend).toBe(deviceBackend);
  });

  it("does not retry unrelated failures", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: true, baseUrl: "http://node:8787" }),
    );
    mocks.renderSegments.mockRejectedValue(new Error("ffmpeg exited with 1"));

    await expect(
      renderVideoWithResolvedBackend(options, { configRepository }),
    ).rejects.toThrow("ffmpeg exited with 1");

    expect(mocks.renderSegments).toHaveBeenCalledTimes(1);
  });

  it("does not retry after the run was aborted", async () => {
    mocks.getSettings.mockResolvedValue(
      settings({ enabled: true, baseUrl: "http://node:8787" }),
    );
    const controller = new AbortController();
    mocks.renderSegments.mockImplementation(async () => {
      controller.abort();
      throw new Error("Something is not supported by this render node");
    });

    await expect(
      renderVideoWithResolvedBackend(
        { ...options, abortSignal: controller.signal },
        { configRepository },
      ),
    ).rejects.toThrow("not supported by this render node");

    expect(mocks.renderSegments).toHaveBeenCalledTimes(1);
  });
});
