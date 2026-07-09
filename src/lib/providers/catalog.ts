import {
  ANTHROPIC_PROVIDER,
} from "@/lib/providers/anthropic";
import { GOOGLE_PROVIDER } from "@/lib/providers/google";
import { OPENAI_COMPATIBLE_PROVIDER } from "@/lib/providers/openai-compatible";
import {
  OPENAI_API_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
} from "@/lib/providers/openai";
import { OPENROUTER_PROVIDER } from "@/lib/providers/openrouter";
import { resolveModelProfile } from "@/lib/providers/profile";
import type { SupportedProviderDefinition } from "@/lib/providers/types";
import type {
  CuratedModelDefinition,
  ModelPreset,
  ProviderConfig,
  ProviderFamily,
  ResolvedModel,
} from "@/types/app-state";
import { createModelRef } from "@/types/app-state";

const SUPPORTED_PROVIDERS = [
  OPENAI_OAUTH_PROVIDER,
  OPENAI_API_PROVIDER,
  ANTHROPIC_PROVIDER,
  GOOGLE_PROVIDER,
  OPENROUTER_PROVIDER,
  OPENAI_COMPATIBLE_PROVIDER,
] satisfies SupportedProviderDefinition[];

const PROVIDER_BY_ID = new Map(
  SUPPORTED_PROVIDERS.map((provider) => [provider.config.id, provider]),
);

export const DEFAULT_PROVIDER_CONFIGS = SUPPORTED_PROVIDERS.map(
  (provider) => provider.config,
);

export const CURATED_MODEL_CATALOG: Record<
  ProviderFamily,
  CuratedModelDefinition[]
> = {
  openai: OPENAI_API_PROVIDER.models,
  anthropic: ANTHROPIC_PROVIDER.models,
  google: GOOGLE_PROVIDER.models,
  openrouter: OPENROUTER_PROVIDER.models,
  "openai-compatible": OPENAI_COMPATIBLE_PROVIDER.models,
};

export function getCatalogForFamily(family: ProviderFamily) {
  return CURATED_MODEL_CATALOG[family];
}

export function getSupportedProviderDefinition(providerId: string) {
  return PROVIDER_BY_ID.get(providerId) ?? null;
}

export function getSuggestedModelsForProvider(
  provider: Pick<ProviderConfig, "family" | "id">,
): CuratedModelDefinition[] {
  const supported = getSupportedProviderDefinition(provider.id);

  if (supported) {
    return supported.models;
  }

  return getCatalogForFamily(provider.family);
}

export function resolveConfiguredModel(input: {
  active: boolean;
  isDefault: boolean;
  modelId: string;
  options?: Record<string, unknown> | null;
  preset?: ModelPreset | null;
  provider: Pick<
    ProviderConfig,
    "authType" | "family" | "id" | "label"
  >;
}): ResolvedModel | null {
  const suggestion = getSuggestedModelsForProvider(input.provider).find(
    (item) => item.id === input.modelId,
  );

  if (!suggestion) {
    return null;
  }

  const profile = resolveModelProfile({
    authType: input.provider.authType,
    family: input.provider.family,
    hintCapabilities: suggestion.capabilities,
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
    isDefault: input.isDefault,
    source: "suggested",
    active: input.active,
    capabilities: profile.capabilities,
    supportsTools: profile.capabilities.tools,
    supportsImageInput: profile.capabilities.imageInput,
    supportsImageGeneration: profile.capabilities.imageGeneration,
    transport: profile.transport,
    options: input.options ?? input.preset?.options ?? suggestion.options ?? null,
  };
}
