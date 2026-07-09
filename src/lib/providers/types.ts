import type {
  CuratedModelDefinition,
  ProviderConfig,
} from "@/types/app-state";

export type ProviderDefaults = Omit<
  ProviderConfig,
  "createdAt" | "updatedAt"
>;

export type SupportedProviderDefinition = {
  config: ProviderDefaults;
  models: CuratedModelDefinition[];
};
