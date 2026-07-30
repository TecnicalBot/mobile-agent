import type { ProviderConfig } from "@/core/types/app-state";

export type ProviderDefaults = Omit<
  ProviderConfig,
  "createdAt" | "updatedAt"
>;

export type SupportedProviderDefinition = {
  config: ProviderDefaults;
};
