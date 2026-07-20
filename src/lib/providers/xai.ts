import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const XAI_PROVIDER = {
  config: {
    id: "xai",
    family: "xai",
    label: "xAI",
    authType: "apiKey",
    baseUrl: "https://api.x.ai/v1",
    enabled: false,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;
