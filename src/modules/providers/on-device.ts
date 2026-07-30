import type { SupportedProviderDefinition } from "@/modules/providers/types";

export const ON_DEVICE_PROVIDER = {
  config: {
    id: "on-device",
    family: "on-device",
    label: "On-device",
    authType: "none",
    baseUrl: null,
    enabled: false,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;
