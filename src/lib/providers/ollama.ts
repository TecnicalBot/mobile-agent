import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const OLLAMA_PROVIDER = {
  config: {
    id: "ollama",
    family: "ollama",
    label: "Ollama",
    authType: "none",
    baseUrl: "http://localhost:11434",
    enabled: false,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;
