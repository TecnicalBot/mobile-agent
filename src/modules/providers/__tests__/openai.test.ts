import { describe, expect, it } from "vitest";

import {
  getOpenAiOAuthFlavor,
  isOpenAiSubscriptionProvider,
} from "@/modules/providers/openai";

describe("getOpenAiOAuthFlavor", () => {
  it("returns the flavor for the OAuth OpenAI providers", () => {
    expect(getOpenAiOAuthFlavor("openai")).toBe("codex");
    expect(getOpenAiOAuthFlavor("openai-chatgpt")).toBe("chatgpt");
  });

  it("returns null for providers without OAuth flavor", () => {
    expect(getOpenAiOAuthFlavor("openai-api")).toBeNull();
    expect(getOpenAiOAuthFlavor("anthropic")).toBeNull();
  });
});

describe("isOpenAiSubscriptionProvider", () => {
  it("is true only for plan-covered OAuth providers", () => {
    expect(isOpenAiSubscriptionProvider("openai")).toBe(true);
    expect(isOpenAiSubscriptionProvider("openai-chatgpt")).toBe(true);
    expect(isOpenAiSubscriptionProvider("openai-api")).toBe(false);
    expect(isOpenAiSubscriptionProvider("anthropic")).toBe(false);
  });
});