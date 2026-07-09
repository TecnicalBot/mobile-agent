import type {
  ModelCapabilities,
  ModelTransport,
  ProviderAuthType,
  ProviderFamily,
} from "@/types/app-state";

export type ModelProfile = {
  capabilities: ModelCapabilities;
  transport: ModelTransport;
};

const CODEX_ALLOWED_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
]);

const OPENAI_CHAT_ONLY_MODELS = new Set(["gpt-5-chat-latest"]);

const FAMILY_DEFAULT_CAPABILITIES: Record<ProviderFamily, ModelCapabilities> = {
  openai: {
    tools: true,
    imageInput: true,
    imageGeneration: true,
  },
  anthropic: {
    tools: true,
    imageInput: true,
    imageGeneration: false,
  },
  google: {
    tools: true,
    imageInput: true,
    imageGeneration: false,
  },
  openrouter: {
    tools: true,
    imageInput: false,
    imageGeneration: false,
  },
  "openai-compatible": {
    tools: false,
    imageInput: false,
    imageGeneration: false,
  },
};

const FAMILY_DEFAULT_TRANSPORT: Record<ProviderFamily, ModelTransport> = {
  openai: "openaiResponses",
  anthropic: "anthropic",
  google: "google",
  openrouter: "openaiChat",
  "openai-compatible": "openaiCompatible",
};

export function resolveModelProfile(input: {
  authType: ProviderAuthType;
  family: ProviderFamily;
  hintCapabilities?: Partial<ModelCapabilities>;
  hintTransport?: ModelTransport;
  modelId: string;
}): ModelProfile {
  const { authType, family, hintCapabilities, hintTransport, modelId } = input;

  if (family === "openai" && authType === "oauth") {
    const allowed = CODEX_ALLOWED_MODELS.has(modelId);

    return {
      transport: "codexResponses",
      capabilities: {
        ...FAMILY_DEFAULT_CAPABILITIES.openai,
        ...hintCapabilities,
        tools: false,
        imageGeneration: false,
        imageInput: allowed,
      },
    };
  }

  if (family === "openai" && authType === "apiKey") {
    const isChatOnly = OPENAI_CHAT_ONLY_MODELS.has(modelId);

    return {
      transport: hintTransport ?? (isChatOnly ? "openaiChat" : "openaiResponses"),
      capabilities: {
        ...FAMILY_DEFAULT_CAPABILITIES.openai,
        ...hintCapabilities,
        imageGeneration:
          hintCapabilities?.imageGeneration ?? !isChatOnly,
      },
    };
  }

  return {
    transport: hintTransport ?? FAMILY_DEFAULT_TRANSPORT[family],
    capabilities: {
      ...FAMILY_DEFAULT_CAPABILITIES[family],
      ...hintCapabilities,
    },
  };
}

export function isCodexPermittedModel(modelId: string) {
  return CODEX_ALLOWED_MODELS.has(modelId);
}
