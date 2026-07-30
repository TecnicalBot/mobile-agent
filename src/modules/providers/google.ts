import type { SupportedProviderDefinition } from "@/modules/providers/types";

export const GOOGLE_PROVIDER = {
  config: {
    id: "google",
    family: "google",
    label: "Google Gemini",
    authType: "apiKey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    enabled: false,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;
