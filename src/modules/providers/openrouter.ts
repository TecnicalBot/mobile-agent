import type { SupportedProviderDefinition } from "@/modules/providers/types";

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
} satisfies SupportedProviderDefinition;
