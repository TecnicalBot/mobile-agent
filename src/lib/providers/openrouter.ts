import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const OPENROUTER_PROVIDER = {
  config: {
    id: "openrouter",
    family: "openrouter",
    label: "OpenRouter",
    authType: "apiKey",
    baseUrl: "https://openrouter.ai/api/v1",
    enabled: false,
    oauthAccountEmail: null,
  },
  models: [
    {
      id: "openai/gpt-5.5",
      kind: "chat",
      label: "OpenRouter GPT-5.5",
      capabilities: {
        imageGeneration: false,
        imageInput: false,
      },
    },
    {
      id: "openai/gpt-5-mini",
      kind: "small",
      label: "OpenRouter GPT-5 Mini",
      capabilities: {
        imageGeneration: false,
        imageInput: false,
      },
    },
  ],
} satisfies SupportedProviderDefinition;
