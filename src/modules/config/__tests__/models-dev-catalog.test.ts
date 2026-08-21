import { describe, expect, it } from "vitest";

import {
  findModelsDevModel,
  getModelsDevDefinitionsForProvider,
  resolveModelsDevProviderKey,
  type ModelsDevProvider,
} from "../models-dev-catalog";
import type { ProviderConfig } from "@/core/types/app-state";

const catalog: Record<string, ModelsDevProvider> = {
  openai: {
    models: {
      "gpt-5.4": {
        cost: { input: 1.25, output: 10 },
        limit: { context: 400000 },
        name: "GPT-5.4",
        tool_call: true,
      },
    },
  },
  openrouter: {
    api: "https://openrouter.ai/api/v1",
    models: {
      "poolside/laguna-s-2.1": {
        cost: { input: 0.09, output: 0.18 },
        limit: { context: 1000000 },
        name: "Poolside: Laguna S 2.1",
        tool_call: true,
      },
      "poolside/laguna-s-2.1:free": {
        cost: { input: 0, output: 0 },
        limit: { context: 262144 },
        name: "Poolside: Laguna S 2.1 (free)",
        tool_call: true,
      },
      "nvidia/nemotron-3-super-120b-a12b:free": {
        cost: { input: 0, output: 0 },
        id: "nvidia/nemotron-3-super-120b-a12b:free",
        limit: { context: 256000 },
        name: "NVIDIA: Nemotron 3 Super (free)",
        reasoning: true,
        tool_call: true,
      },
      "old/model": {
        cost: { input: 1, output: 2 },
        id: "old/model",
        limit: { context: 8192 },
        name: "Old Model",
        status: "deprecated",
      },
    },
  },
};

function makeProvider(
  overrides: Partial<ProviderConfig> & Pick<ProviderConfig, "id" | "family">,
): ProviderConfig {
  return {
    authType: "apiKey",
    baseUrl: null,
    enabled: true,
    label: overrides.id,
    oauthAccountEmail: null,
    ...overrides,
  } as ProviderConfig;
}

describe("resolveModelsDevProviderKey", () => {
  it("maps built-in provider ids to catalog keys", () => {
    expect(
      resolveModelsDevProviderKey(catalog, makeProvider({ id: "openrouter", family: "openrouter" })),
    ).toBe("openrouter");
  });

  it("aliases openai-api to the openai catalog entry", () => {
    expect(
      resolveModelsDevProviderKey(catalog, makeProvider({ id: "openai-api", family: "openai" })),
    ).toBe("openai");
  });

  it("aliases fireworks to fireworks-ai", () => {
    expect(
      resolveModelsDevProviderKey(
        { "fireworks-ai": { models: {} } },
        makeProvider({ id: "fireworks", family: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1" }),
      ),
    ).toBe("fireworks-ai");
  });
});

describe("findModelsDevModel", () => {
  it("returns per-token prices converted from per-million costs", () => {
    const info = findModelsDevModel(catalog, "openrouter", "poolside/laguna-s-2.1");
    expect(info).toEqual({
      contextWindow: 1000000,
      inputPricePerToken: 0.00000009,
      outputPricePerToken: 0.00000018,
    });
  });

  it("returns zero prices for :free variants instead of null", () => {
    const info = findModelsDevModel(catalog, "openrouter", "poolside/laguna-s-2.1:free");
    expect(info?.inputPricePerToken).toBe(0);
    expect(info?.outputPricePerToken).toBe(0);
  });

  it("resolves aliased providers", () => {
    expect(findModelsDevModel(catalog, "openai-api", "gpt-5.4")?.contextWindow).toBe(400000);
  });

  it("falls back to scanning all providers for exact ids", () => {
    const info = findModelsDevModel(catalog, "unknown-custom-provider", "gpt-5.4");
    expect(info?.inputPricePerToken).toBe(0.00000125);
  });

  it("falls back to owner-prefixed suffix matches within a provider", () => {
    const info = findModelsDevModel(catalog, "openrouter", "laguna-s-2.1:free");
    expect(info?.contextWindow).toBe(262144);
  });

  it("returns null for unknown models", () => {
    expect(findModelsDevModel(catalog, "openrouter", "nope")).toBeNull();
  });
});

describe("getModelsDevDefinitionsForProvider", () => {
  it("lists OpenRouter models with real ids including :free variants", () => {
    const definitions = getModelsDevDefinitionsForProvider(
      catalog,
      makeProvider({ id: "openrouter", family: "openrouter" }),
    );
    const ids = definitions.map((definition) => definition.id);
    expect(ids).toContain("poolside/laguna-s-2.1:free");
    expect(ids).toContain("nvidia/nemotron-3-super-120b-a12b:free");
    expect(ids).not.toContain("old/model");
  });

  it("marks zero-cost models as free and paid models as not free", () => {
    const definitions = getModelsDevDefinitionsForProvider(
      catalog,
      makeProvider({ id: "openrouter", family: "openrouter" }),
    );
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    expect(byId.get("poolside/laguna-s-2.1:free")?.isFree).toBe(true);
    expect(byId.get("poolside/laguna-s-2.1")?.isFree).toBeUndefined();
  });

  it("maps capabilities and context windows", () => {
    const definitions = getModelsDevDefinitionsForProvider(
      catalog,
      makeProvider({ id: "openrouter", family: "openrouter" }),
    );
    const nemotron = definitions.find(
      (definition) => definition.id === "nvidia/nemotron-3-super-120b-a12b:free",
    );
    expect(nemotron?.capabilities?.tools).toBe(true);
    expect(nemotron?.capabilities?.reasoning).toBe(true);
    expect(nemotron?.contextWindow).toBe(256000);
  });

  it("serves every cloud provider family but not ollama or on-device", () => {
    expect(
      getModelsDevDefinitionsForProvider(catalog, makeProvider({ id: "openai-api", family: "openai" })),
    ).toHaveLength(1);
    expect(
      getModelsDevDefinitionsForProvider(catalog, makeProvider({ id: "anthropic", family: "anthropic" })),
    ).toEqual([]);
    expect(
      getModelsDevDefinitionsForProvider(catalog, makeProvider({ id: "google", family: "google" })),
    ).toEqual([]);
    expect(
      getModelsDevDefinitionsForProvider(catalog, makeProvider({ id: "xai", family: "xai" })),
    ).toEqual([]);
    expect(
      getModelsDevDefinitionsForProvider(
        catalog,
        makeProvider({ id: "catalog-custom", family: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1" }),
      ),
    ).toHaveLength(3);
    expect(
      getModelsDevDefinitionsForProvider(catalog, makeProvider({ id: "ollama", family: "ollama" })),
    ).toEqual([]);
    expect(
      getModelsDevDefinitionsForProvider(catalog, makeProvider({ id: "on-device", family: "on-device" })),
    ).toEqual([]);
  });
});
