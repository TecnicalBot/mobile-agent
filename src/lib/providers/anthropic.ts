import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const ANTHROPIC_PROVIDER = {
  config: {
    id: "anthropic",
    family: "anthropic",
    label: "Anthropic",
    authType: "apiKey",
    baseUrl: "https://api.anthropic.com/v1",
    enabled: false,
    oauthAccountEmail: null,
  },
  models: [
    {
      id: "claude-sonnet-4-5",
      kind: "chat",
      label: "Claude Sonnet 4.5",
      options: {
        thinking: {
          type: "enabled",
          budgetTokens: 4096,
        },
      },
    },
    {
      id: "claude-haiku-4-5",
      kind: "small",
      label: "Claude Haiku 4.5",
    },
  ],
} satisfies SupportedProviderDefinition;
