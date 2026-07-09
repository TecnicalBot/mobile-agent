import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const OPENAI_COMPATIBLE_PROVIDER = {
  config: {
    id: "openai-compatible",
    family: "openai-compatible",
    label: "Custom OpenAI-Compatible",
    authType: "apiKey",
    baseUrl: "",
    enabled: false,
    oauthAccountEmail: null,
  },
  models: [
    {
      id: "gpt-5.5",
      kind: "chat",
      label: "Compatible GPT-5.5",
      capabilities: {
        imageGeneration: false,
        imageInput: false,
        tools: false,
      },
    },
    {
      id: "gpt-5-mini",
      kind: "small",
      label: "Compatible GPT-5 Mini",
      capabilities: {
        imageGeneration: false,
        imageInput: false,
        tools: false,
      },
    },
  ],
} satisfies SupportedProviderDefinition;
