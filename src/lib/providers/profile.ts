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

const OPENAI_CHAT_ONLY_MODELS = new Set(["gpt-5-chat-latest"]);

const FAMILY_DEFAULT_CAPABILITIES: Record<ProviderFamily, ModelCapabilities> = {
  openai: {
    tools: true,
    imageInput: true,
    imageGeneration: true,
    reasoning: false,
  },
  anthropic: {
    tools: true,
    imageInput: true,
    imageGeneration: false,
    reasoning: false,
  },
  google: {
    tools: true,
    imageInput: true,
    imageGeneration: false,
    reasoning: false,
  },
  "on-device": {
    tools: true,
    imageInput: false,
    imageGeneration: false,
    reasoning: false,
  },
  openrouter: {
    tools: true,
    imageInput: false,
    imageGeneration: false,
    reasoning: false,
  },
  ollama: {
    tools: true,
    imageInput: false,
    imageGeneration: false,
    reasoning: false,
  },
  xai: {
    tools: true,
    imageInput: true,
    imageGeneration: false,
    reasoning: false,
  },
  "openai-compatible": {
    tools: true,
    imageInput: false,
    imageGeneration: false,
    reasoning: false,
  },
};

function modelIdLikelySupportsReasoning(modelId: string) {
  return /(?:^|[\/.:-])(?:gpt-5|o[134](?:-|$)|claude-(?:3-7|4)|gemini-(?:2\.5|3)|deepseek-r1|qwq|reasoning|thinking)/i.test(
    modelId,
  );
}

const FAMILY_DEFAULT_TRANSPORT: Record<ProviderFamily, ModelTransport> = {
  openai: "openaiResponses",
  anthropic: "anthropic",
  google: "google",
  "on-device": "onDevice",
  openrouter: "openaiChat",
  ollama: "openaiCompatible",
  xai: "openaiCompatible",
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
    return {
      transport: "codexResponses",
      capabilities: {
        ...FAMILY_DEFAULT_CAPABILITIES.openai,
        ...hintCapabilities,
        tools: hintCapabilities?.tools ?? true,
        imageGeneration: false,
        imageInput: hintCapabilities?.imageInput ?? false,
        reasoning:
          hintCapabilities?.reasoning ??
          modelIdLikelySupportsReasoning(modelId),
      },
    };
  }

  if (family === "openai" && authType === "apiKey") {
    const isChatOnly = OPENAI_CHAT_ONLY_MODELS.has(modelId);

    return {
      transport:
        hintTransport ?? (isChatOnly ? "openaiChat" : "openaiResponses"),
      capabilities: {
        ...FAMILY_DEFAULT_CAPABILITIES.openai,
        ...hintCapabilities,
        imageGeneration: hintCapabilities?.imageGeneration ?? !isChatOnly,
        reasoning:
          hintCapabilities?.reasoning ??
          modelIdLikelySupportsReasoning(modelId),
      },
    };
  }

  return {
    transport: hintTransport ?? FAMILY_DEFAULT_TRANSPORT[family],
    capabilities: {
      ...FAMILY_DEFAULT_CAPABILITIES[family],
      ...hintCapabilities,
      reasoning:
        hintCapabilities?.reasoning ?? modelIdLikelySupportsReasoning(modelId),
    },
  };
}
