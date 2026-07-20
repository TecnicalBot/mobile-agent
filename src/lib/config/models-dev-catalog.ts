import type { CuratedModelDefinition, ProviderConfig } from "@/types/app-state";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 5 * 60 * 1000;

type ModelsDevModel = {
  id?: string;
  name?: string;
  status?: string;
  tool_call?: boolean;
  attachment?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
};

type ModelsDevProvider = {
  models?: Record<string, ModelsDevModel>;
};

let cachedCatalog: {
  expiresAt: number;
  providers: Record<string, ModelsDevProvider>;
} | null = null;

const PROVIDER_ID_ALIASES: Record<string, string> = {
  fireworks: "fireworks-ai",
};

export async function fetchModelsDevCatalogCached() {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.providers;
  }

  const response = await fetch(MODELS_DEV_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`models.dev catalog request failed (${response.status}).`);
  }

  const providers = (await response.json()) as Record<
    string,
    ModelsDevProvider
  >;
  cachedCatalog = {
    expiresAt: Date.now() + CATALOG_TTL_MS,
    providers,
  };
  return providers;
}

export function getModelsDevDefinitionsForProvider(
  catalog: Record<string, ModelsDevProvider>,
  provider: ProviderConfig,
): CuratedModelDefinition[] {
  if (
    (provider.family !== "openai-compatible" && provider.family !== "xai") ||
    provider.id === "openai-compatible"
  ) {
    return [];
  }

  const catalogId = PROVIDER_ID_ALIASES[provider.id] ?? provider.id;
  const models = catalog[catalogId]?.models ?? {};

  return Object.entries(models).flatMap(([key, model]) => {
    if (model.status === "deprecated") return [];

    const id = model.id?.trim() || key;
    const inputModalities = model.modalities?.input ?? [];
    const outputModalities = model.modalities?.output ?? [];
    const imageGeneration = outputModalities.includes("image");

    return [
      {
        capabilities: {
          imageGeneration,
          imageInput:
            inputModalities.includes("image") || model.attachment === true,
          reasoning: model.reasoning === true ? true : undefined,
          tools: model.tool_call === true,
        },
        id,
        kind: /(?:mini|nano|small|flash-lite)/i.test(id) ? "small" : "chat",
        label: model.name?.trim() || id,
        outputType: imageGeneration ? "image" : "text",
      },
    ];
  });
}
