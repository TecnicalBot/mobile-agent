import type { SupportedProviderDefinition } from "@/lib/providers/types";

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
  models: [
    {
      id: "gpt-5.5",
      kind: "chat",
      label: "GPT-5.5",
      options: {
        reasoningEffort: "high",
        textVerbosity: "low",
      },
    },
    {
      id: "gpt-5.4",
      kind: "chat",
      label: "GPT-5.4",
      options: {
        reasoningEffort: "medium",
        textVerbosity: "low",
      },
    },
    {
      id: "gpt-5.4-mini",
      kind: "small",
      label: "GPT-5.4 Mini",
      options: {
        reasoningEffort: "low",
        textVerbosity: "low",
      },
    },
  ],
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
  models: [
    {
      id: "gpt-5.5",
      kind: "chat",
      label: "GPT-5.5",
      options: {
        reasoningEffort: "high",
        textVerbosity: "low",
      },
    },
    {
      id: "gpt-5",
      kind: "chat",
      label: "GPT-5",
      options: {
        reasoningEffort: "medium",
        textVerbosity: "low",
      },
    },
    {
      id: "gpt-5-mini",
      kind: "small",
      label: "GPT-5 Mini",
      options: {
        reasoningEffort: "low",
        textVerbosity: "low",
      },
    },
    {
      id: "gpt-5-nano",
      kind: "small",
      label: "GPT-5 Nano",
      options: {
        reasoningEffort: "minimal",
        textVerbosity: "low",
      },
    },
    {
      id: "gpt-5-chat-latest",
      kind: "chat",
      label: "GPT-5 Chat Latest",
      capabilities: {
        imageGeneration: false,
      },
      transport: "openaiChat",
    },
  ],
} satisfies SupportedProviderDefinition;
