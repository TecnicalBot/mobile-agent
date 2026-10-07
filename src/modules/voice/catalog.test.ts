import { afterEach, describe, expect, it, vi } from "vitest";
import bundledCatalog from "../../../catalog/voice-models.json";

const VALID = {
  version: 1,
  models: [
    {
      id: "tiny",
      label: "Whisper Tiny",
      description: "Fastest",
      url: "https://example.com/ggml-tiny.bin",
      sizeBytes: 1234,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadCatalogModule() {
  return import("./catalog");
}

describe("Voice model catalog", () => {
  it("parses the bundled catalog and includes the expected models", async () => {
    const { getBundledVoiceModelCatalog } = await loadCatalogModule();
    const models = getBundledVoiceModelCatalog();
    expect(models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["tiny", "base", "small"]),
    );
    expect(models.every((model) => model.url.startsWith("https://"))).toBe(
      true,
    );
    expect(models.every((model) => model.sizeBytes > 0)).toBe(true);
    expect(bundledCatalog.version).toBe(1);
  });
  it("rejects an unsupported version", async () => {
    const { parseVoiceModelCatalog } = await loadCatalogModule();
    expect(() => parseVoiceModelCatalog({ ...VALID, version: 2 })).toThrow(
      "version",
    );
  });
  it("rejects non-HTTPS, invalid size and bad ids", async () => {
    const { parseVoiceModelCatalog } = await loadCatalogModule();
    expect(() =>
      parseVoiceModelCatalog({
        ...VALID,
        models: [{ ...VALID.models[0], url: "http://example.com/x.bin" }],
      }),
    ).toThrow("HTTPS");
    expect(() =>
      parseVoiceModelCatalog({
        ...VALID,
        models: [{ ...VALID.models[0], sizeBytes: 0 }],
      }),
    ).toThrow("positive integer");
    expect(() =>
      parseVoiceModelCatalog({
        ...VALID,
        models: [{ ...VALID.models[0], id: "Bad Id" }],
      }),
    ).toThrow("Invalid voice catalog model id");
  });
  it("rejects duplicate ids", async () => {
    const { parseVoiceModelCatalog } = await loadCatalogModule();
    expect(() =>
      parseVoiceModelCatalog({
        ...VALID,
        models: [VALID.models[0], VALID.models[0]],
      }),
    ).toThrow("Duplicate");
  });
  it("parses optional supportedLanguages and rejects bad shapes", async () => {
    const { parseVoiceModelCatalog } = await loadCatalogModule();
    const withLanguages = parseVoiceModelCatalog({
      ...VALID,
      models: [{ ...VALID.models[0], supportedLanguages: ["en", "es"] }],
    });
    expect(withLanguages[0].supportedLanguages).toEqual(["en", "es"]);
    expect(() =>
      parseVoiceModelCatalog({
        ...VALID,
        models: [{ ...VALID.models[0], supportedLanguages: "en" }],
      }),
    ).toThrow("supportedLanguages");
  });
  it("uses the remote catalog when GitHub responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: 1,
          models: [
            {
              id: "remote-only",
              label: "Remote Model",
              description: "From GitHub",
              url: "https://example.com/remote.bin",
              sizeBytes: 999,
            },
          ],
        }),
      })),
    );
    const { fetchVoiceModelCatalogCached } = await loadCatalogModule();
    const models = await fetchVoiceModelCatalogCached();
    expect(models.map((model) => model.id)).toEqual(["remote-only"]);
  });
  it("falls back to the bundled catalog when GitHub fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { fetchVoiceModelCatalogCached } = await loadCatalogModule();
    const models = await fetchVoiceModelCatalogCached();
    expect(models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["tiny", "base", "small"]),
    );
  });
});
