import type { SupportedProviderDefinition } from "@/modules/providers/types";
import type { ProviderConfig } from "@/core/types/app-state";

export const OPENAI_OAUTH_PROVIDER = {
  config: {
    id: "openai",
    family: "openai",
    label: "OpenAI (Codex sign-in)",
    authType: "oauth",
    baseUrl: null,
    enabled: true,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;

export const OPENAI_CHATGPT_PROVIDER = {
  config: {
    id: "openai-chatgpt",
    family: "openai",
    label: "OpenAI (ChatGPT plan)",
    authType: "oauth",
    baseUrl: "https://api.openai.com/v1",
    enabled: false,
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

export const OPENAI_CODEX_PROVIDER_ID = "openai";
export const OPENAI_CHATGPT_PROVIDER_ID = "openai-chatgpt";

export type OpenAiOAuthFlavor = "codex" | "chatgpt";

/**
 * Returns the OAuth flavor for an OpenAI provider id, or null when the id is
 * not one of the two OAuth-backed OpenAI providers.
 */
export function getOpenAiOAuthFlavor(providerId: string): OpenAiOAuthFlavor | null {
  if (providerId === OPENAI_CODEX_PROVIDER_ID) return "codex";
  if (providerId === OPENAI_CHATGPT_PROVIDER_ID) return "chatgpt";
  return null;
}

export function isOpenAiOAuthProvider(
  provider: Pick<ProviderConfig, "authType" | "family">,
) {
  return provider.family === "openai" && provider.authType === "oauth";
}

export function isOpenAiChatGptProvider(providerId: string) {
  return getOpenAiOAuthFlavor(providerId) === "chatgpt";
}
