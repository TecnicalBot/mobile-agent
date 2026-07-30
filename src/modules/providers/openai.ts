import type { SupportedProviderDefinition } from "@/modules/providers/types";

export const OPENAI_OAUTH_PROVIDER = {
  config: {
    id: "openai",
    family: "openai",
    label: "OpenAI (ChatGPT OAuth)",
    authType: "oauth",
    baseUrl: null,
    enabled: true,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;

export const OPENAI_API_PROVIDER = {
  config: {
    id: "openai-api",
    family: "openai",
    label: "OpenAI API",
    authType: "apiKey",
    baseUrl: "https://api.openai.com/v1",
    enabled: false,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;
