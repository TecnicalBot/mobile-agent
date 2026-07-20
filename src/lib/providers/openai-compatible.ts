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
} satisfies SupportedProviderDefinition;

const OPENAI_COMPATIBLE_PROFILES = [
  ["baseten", "Baseten", "https://inference.baseten.co/v1"],
  ["cerebras", "Cerebras", "https://api.cerebras.ai/v1"],
  ["deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai"],
  ["deepseek", "DeepSeek", "https://api.deepseek.com/v1"],
  ["fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1"],
  ["groq", "Groq", "https://api.groq.com/openai/v1"],
  ["togetherai", "Together AI", "https://api.together.xyz/v1"],
] as const;

export const OPENAI_COMPATIBLE_PROFILE_PROVIDERS =
  OPENAI_COMPATIBLE_PROFILES.map(([id, label, baseUrl]) => ({
    config: {
      id,
      family: "openai-compatible" as const,
      label,
      authType: "apiKey" as const,
      baseUrl,
      enabled: false,
      oauthAccountEmail: null,
    },
  })) satisfies SupportedProviderDefinition[];
