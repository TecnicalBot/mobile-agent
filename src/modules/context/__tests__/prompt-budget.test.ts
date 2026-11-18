import { describe, expect, it } from "vitest";

import {
  isPromptBudgetExceeded,
  MIN_USABLE_CONTEXT_TOKENS,
  resolvePromptProfile,
} from "@/modules/context/prompt-budget";

describe("prompt budget profiles", () => {
  it("uses the minimal profile for tiny on-device windows", () => {
    expect(resolvePromptProfile({ contextWindow: 4_096 })).toBe("minimal");
    expect(resolvePromptProfile({ contextWindow: 11_999 })).toBe("minimal");
  });

  it("uses compact for mid-sized windows", () => {
    expect(resolvePromptProfile({ contextWindow: 12_000 })).toBe("compact");
    expect(resolvePromptProfile({ contextWindow: 32_000 })).toBe("compact");
  });

  it("uses full for large windows and when unknown", () => {
    expect(resolvePromptProfile({ contextWindow: 40_000 })).toBe("full");
    expect(resolvePromptProfile({ contextWindow: 128_000 })).toBe("full");
    expect(resolvePromptProfile({ contextWindow: null })).toBe("compact");
  });

  it("flags prompts that leave no room for the user's messages", () => {
    const base = {
      contextWindow: 4_096,
      promptTokens: 1_000,
      toolTokens: 1_000,
      reservedTokens: 1_000,
    };

    expect(isPromptBudgetExceeded(base)).toBe(false);
    expect(
      isPromptBudgetExceeded({
        ...base,
        toolTokens: 4_096 - 1_000 - 1_000 - MIN_USABLE_CONTEXT_TOKENS + 1,
      }),
    ).toBe(true);
  });
});
