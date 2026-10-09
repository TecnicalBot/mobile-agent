import { describe, expect, it, vi } from "vitest";

import {
  CHATGPT_FALLBACK_MODEL_SLUGS,
  filterChatGptRemoteModels,
  formatChatGptModelLabel,
  getFallbackChatGptModels,
  isChatGptRemoteModel,
  mapChatGptRemoteModel,
  type ChatGptRemoteModel,
} from "@/modules/providers/openai-chatgpt-models";

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

describe("formatChatGptModelLabel", () => {
  it("title-cases slugs and upper-cases the gpt prefix", () => {
    expect(formatChatGptModelLabel("gpt-5.6-luna-fast")).toBe(
      "GPT-5.6 Luna Fast",
    );
    expect(formatChatGptModelLabel("gpt-5.5")).toBe("GPT-5.5");
    expect(formatChatGptModelLabel("o3")).toBe("O3");
  });
});

describe("isChatGptRemoteModel", () => {
  it("only accepts listed models that are served by the API", () => {
    expect(
      isChatGptRemoteModel({ slug: "a", visibility: "list", supported_in_api: true }),
    ).toBe(true);
    expect(
      isChatGptRemoteModel({
        slug: "b",
        visibility: "hidden",
        supported_in_api: true,
      }),
    ).toBe(false);
    expect(
      isChatGptRemoteModel({ slug: "c", visibility: "list", supported_in_api: false }),
    ).toBe(false);
  });
});

describe("filterChatGptRemoteModels", () => {
  it("keeps only API-listable models", () => {
    const models: ChatGptRemoteModel[] = [
      { slug: "gpt-5.5", visibility: "list", supported_in_api: true },
      { slug: "secret", visibility: "hidden", supported_in_api: true },
      { slug: "legacy", visibility: "list", supported_in_api: false },
    ];

    expect(filterChatGptRemoteModels(models).map((m) => m.slug)).toEqual([
      "gpt-5.5",
    ]);
  });
});

describe("mapChatGptRemoteModel", () => {
  it("maps remote fields onto a curated model definition", () => {
    const mapped = mapChatGptRemoteModel({
      slug: "gpt-5.6-luna",
      display_name: "Luna",
      context_window: 400_000,
      input_modalities: ["text", "image"],
      supported_reasoning_levels: [{ effort: "high" }],
    });

    expect(mapped).toMatchObject({
      id: "gpt-5.6-luna",
      kind: "chat",
      label: "Luna",
      contextWindow: 400_000,
      transport: "openaiResponses",
    });
    expect(mapped.capabilities).toMatchObject({
      tools: true,
      imageInput: true,
      imageGeneration: false,
      reasoning: true,
    });
  });

  it("falls back to a formatted label when display_name is absent", () => {
    const mapped = mapChatGptRemoteModel({ slug: "gpt-6-sol-fast" });

    expect(mapped.label).toBe("GPT-6 Sol Fast");
    expect(mapped.contextWindow).toBeNull();
    expect(mapped.capabilities?.reasoning).toBe(false);
  });
});

describe("getFallbackChatGptModels", () => {
  it("returns every allowlisted slug over the Responses transport", () => {
    const models = getFallbackChatGptModels();

    expect(models).toHaveLength(CHATGPT_FALLBACK_MODEL_SLUGS.length);
    expect(models.map((model) => model.id)).toEqual([
      ...CHATGPT_FALLBACK_MODEL_SLUGS,
    ]);

    for (const model of models) {
      expect(model.transport).toBe("openaiResponses");
      expect(model.capabilities?.tools).toBe(true);
    }
  });
});
