import { ANTHROPIC_PROVIDER } from "@/modules/providers/anthropic";
import { GOOGLE_PROVIDER } from "@/modules/providers/google";
import { OPENAI_COMPATIBLE_PROFILE_PROVIDERS } from "@/modules/providers/openai-compatible";
import {
  OPENAI_API_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
} from "@/modules/providers/openai";
import { OPENROUTER_PROVIDER } from "@/modules/providers/openrouter";
import { OLLAMA_PROVIDER } from "@/modules/providers/ollama";
import { ON_DEVICE_PROVIDER } from "@/modules/providers/on-device";
import { XAI_PROVIDER } from "@/modules/providers/xai";
import { resolveModelProfile } from "@/modules/providers/profile";
import type { SupportedProviderDefinition } from "@/modules/providers/types";
import type {
  CuratedModelDefinition,
  ModelPreset,
  ProviderConfig,
  ResolvedModel,
} from "@/core/types/app-state";
import { createModelRef } from "@/core/types/app-state";

const SUPPORTED_PROVIDERS = [
  OPENAI_OAUTH_PROVIDER,
  OPENAI_API_PROVIDER,
  ANTHROPIC_PROVIDER,
  GOOGLE_PROVIDER,
  OPENROUTER_PROVIDER,
  OLLAMA_PROVIDER,
  ON_DEVICE_PROVIDER,
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
    isFree: catalogSuggestion?.isFree ?? false,
    source: catalogSuggestion ? "suggested" : "custom",
    active: input.active,
    capabilities: profile.capabilities,
    supportsTools: profile.capabilities.tools,
    supportsImageInput: profile.capabilities.imageInput,
    supportsImageGeneration: profile.capabilities.imageGeneration,
    supportsReasoning: profile.capabilities.reasoning,
    transport: profile.transport,
    contextWindow: suggestion.contextWindow ?? null,
    options:
      input.options ?? input.preset?.options ?? suggestion.options ?? null,
  };
}
