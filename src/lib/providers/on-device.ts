import type { SupportedProviderDefinition } from "@/lib/providers/types";
import type { CuratedModelDefinition } from "@/types/app-state";

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

export const ON_DEVICE_MODELS = [
  {
    id: "gemma-e2b",
    kind: "chat",
    label: "Gemma 4 E2B",
    transport: "onDevice",
    capabilities: {
      tools: true,
      imageInput: false,
      imageGeneration: false,
      reasoning: false,
    },
    options: {
      onDevice: {
        backend: "auto",
        contextWindow: 8_000,
        downloadBytes: 2_588_147_712,
        minRamBytes: 2_000_000_000,
      },
    },
  },
  {
    id: "gemma-e4b",
    kind: "chat",
    label: "Gemma 4 E4B",
    transport: "onDevice",
    capabilities: {
      tools: true,
      imageInput: false,
      imageGeneration: false,
      reasoning: false,
    },
    options: {
      onDevice: {
        backend: "auto",
        contextWindow: 16_000,
        downloadBytes: 3_659_530_240,
        minRamBytes: 3_000_000_000,
      },
    },
  },
] satisfies CuratedModelDefinition[];
