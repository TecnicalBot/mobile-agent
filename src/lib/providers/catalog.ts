import { ANTHROPIC_PROVIDER } from "@/lib/providers/anthropic";
import { GOOGLE_PROVIDER } from "@/lib/providers/google";
import {
  OPENAI_COMPATIBLE_PROFILE_PROVIDERS,
  OPENAI_COMPATIBLE_PROVIDER,
} from "@/lib/providers/openai-compatible";
import {
  OPENAI_API_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
} from "@/lib/providers/openai";
import { OPENROUTER_PROVIDER } from "@/lib/providers/openrouter";
import { OLLAMA_PROVIDER } from "@/lib/providers/ollama";
import { XAI_PROVIDER } from "@/lib/providers/xai";
import { resolveModelProfile } from "@/lib/providers/profile";
import type { SupportedProviderDefinition } from "@/lib/providers/types";
import type {
  CuratedModelDefinition,
  ModelPreset,
  ProviderConfig,
  ResolvedModel,
} from "@/types/app-state";
import { createModelRef } from "@/types/app-state";

const SUPPORTED_PROVIDERS = [
  OPENAI_OAUTH_PROVIDER,
  OPENAI_API_PROVIDER,
  ANTHROPIC_PROVIDER,
  GOOGLE_PROVIDER,
  OPENROUTER_PROVIDER,
  OLLAMA_PROVIDER,
  OPENAI_COMPATIBLE_PROVIDER,
  ...OPENAI_COMPATIBLE_PROFILE_PROVIDERS,
  XAI_PROVIDER,
] satisfies SupportedProviderDefinition[];

const PROVIDER_BY_ID = new Map(
  SUPPORTED_PROVIDERS.map((provider) => [provider.config.id, provider]),
);

export const DEFAULT_PROVIDER_CONFIGS = SUPPORTED_PROVIDERS.map(
  (provider) => provider.config,
);

export function getSupportedProviderDefinition(providerId: string) {
  return PROVIDER_BY_ID.get(providerId) ?? null;
}

export function resolveConfiguredModel(input: {
  active: boolean;
  definition?: CuratedModelDefinition;
  isDefault: boolean;
  modelId: string;
  options?: Record<string, unknown> | null;
  preset?: ModelPreset | null;
  provider: Pick<ProviderConfig, "authType" | "family" | "id" | "label">;
}): ResolvedModel | null {
  const catalogSuggestion = input.definition;
  const suggestion =
    catalogSuggestion ??
    (input.preset
      ? {
          id: input.modelId,
          kind: "chat" as const,
          label: input.preset.label?.trim() || input.modelId,
        }
      : null);

  if (!suggestion) return null;

  const storedProfile = input.preset?.options?.__mobileAgentModelProfile;
  const storedProfileRecord =
    storedProfile &&
    typeof storedProfile === "object" &&
    !Array.isArray(storedProfile)
      ? (storedProfile as Record<string, unknown>)
      : null;
  const storedCapabilities =
    storedProfileRecord?.capabilities &&
    typeof storedProfileRecord.capabilities === "object" &&
    !Array.isArray(storedProfileRecord.capabilities)
      ? (storedProfileRecord.capabilities as Partial<
          ResolvedModel["capabilities"]
        >)
      : undefined;

  const profile = resolveModelProfile({
    authType: input.provider.authType,
    family: input.provider.family,
    hintCapabilities: storedCapabilities ?? suggestion.capabilities,
    hintTransport: suggestion.transport,
    modelId: suggestion.id,
  });

  return {
    ref: createModelRef(input.provider.id, suggestion.id),
    providerId: input.provider.id,
    providerFamily: input.provider.family,
    providerAuthType: input.provider.authType,
    providerLabel: input.provider.label,
    modelId: suggestion.id,
    label: input.preset?.label?.trim() || suggestion.label,
    outputType:
      (storedProfileRecord?.outputType === "image" ? "image" : undefined) ??
      suggestion.outputType ??
      (/\b(image|imagen)\b/i.test(suggestion.id) ? "image" : "text"),
    isDefault: input.isDefault,
    source: catalogSuggestion ? "suggested" : "custom",
    active: input.active,
    capabilities: profile.capabilities,
    supportsTools: profile.capabilities.tools,
    supportsImageInput: profile.capabilities.imageInput,
    supportsImageGeneration: profile.capabilities.imageGeneration,
    supportsReasoning: profile.capabilities.reasoning,
    transport: profile.transport,
    options:
      input.options ?? input.preset?.options ?? suggestion.options ?? null,
  };
}
