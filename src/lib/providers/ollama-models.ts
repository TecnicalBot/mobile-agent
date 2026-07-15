import type { CuratedModelDefinition, ProviderConfig } from "@/types/app-state";

function normalizeOllamaBaseUrl(baseUrl: string | null) {
  return (baseUrl?.trim() || "http://localhost:11434")
    .replace(/\/(?:api|v1)\/?$/, "")
    .replace(/\/$/, "");
}

export function getOllamaOpenAIBaseUrl(baseUrl: string | null) {
  return `${normalizeOllamaBaseUrl(baseUrl)}/v1`;
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOllamaModels(
  provider: Pick<ProviderConfig, "baseUrl">,
  apiKey?: string | null,
): Promise<CuratedModelDefinition[]> {
  const headers = apiKey?.trim()
    ? { Authorization: `Bearer ${apiKey.trim()}` }
    : undefined;
  const response = await fetchWithTimeout(
    `${normalizeOllamaBaseUrl(provider.baseUrl)}/api/tags`,
    { headers },
  );

  if (!response.ok) {
    throw new Error(`Ollama model discovery failed (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as {
    models?: {
      details?: {
        family?: unknown;
        parameter_size?: unknown;
      };
      model?: unknown;
      name?: unknown;
    }[];
  };

  const models = (payload.models ?? []).flatMap((model) => {
    const modelId =
      typeof model.model === "string"
        ? model.model
        : typeof model.name === "string"
          ? model.name
          : null;

    return modelId?.trim() ? [{ model, modelId }] : [];
  });

  return Promise.all(
    models.map(async ({ model, modelId }) => {
      let capabilities: string[] = [];
      let modelInfo: Record<string, unknown> = {};

      try {
        const detailsResponse = await fetchWithTimeout(
          `${normalizeOllamaBaseUrl(provider.baseUrl)}/api/show`,
          {
            body: JSON.stringify({ model: modelId, verbose: false }),
            headers: {
              "Content-Type": "application/json",
              ...(headers ?? {}),
            },
            method: "POST",
          },
        );

        if (detailsResponse.ok) {
          const details = (await detailsResponse.json()) as {
            capabilities?: unknown;
            model_info?: unknown;
          };
          capabilities = Array.isArray(details.capabilities)
            ? details.capabilities.filter(
                (capability): capability is string =>
                  typeof capability === "string",
              )
            : [];
          modelInfo =
            details.model_info &&
            typeof details.model_info === "object" &&
            !Array.isArray(details.model_info)
              ? (details.model_info as Record<string, unknown>)
              : {};
        }
      } catch {
        // Keep the model available with conservative capabilities.
      }

      const family =
        typeof model.details?.family === "string"
          ? model.details.family
          : null;
      const contextWindow = Object.entries(modelInfo).find(([key, value]) =>
        key.endsWith(".context_length") && typeof value === "number",
      )?.[1];

      return {
        id: modelId,
        kind: "chat" as const,
        label: modelId,
        capabilities: {
          imageInput: capabilities.includes("vision"),
          reasoning:
            capabilities.includes("thinking") ||
            capabilities.includes("reasoning"),
          tools: capabilities.includes("tools"),
        },
        options: {
          ollama: {
            capabilities,
            contextWindow:
              typeof contextWindow === "number" ? contextWindow : null,
            family,
            parameterSize:
              typeof model.details?.parameter_size === "string"
                ? model.details.parameter_size
                : null,
          },
        },
        transport: "openaiCompatible" as const,
      };
    }),
  );
}
