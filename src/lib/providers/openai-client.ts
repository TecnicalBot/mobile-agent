import { createOpenAI } from "@ai-sdk/openai";

import {
  getValidOpenAiTokenInfo,
} from "@/lib/openai-oauth";
import type { ModelRuntime } from "@/lib/runtime/providers/types";
import type { SecretStore } from "@/lib/secrets";
import type { ProviderConfig, ResolvedModel } from "@/types/app-state";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const OAUTH_DUMMY_API_KEY = "oauth";

function copyHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers();

  if (!initHeaders) {
    return headers;
  }

  if (initHeaders instanceof Headers) {
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
    return headers;
  }

  if (Array.isArray(initHeaders)) {
    for (const [key, value] of initHeaders) {
      if (value !== undefined) {
        headers.set(key, String(value));
      }
    }
    return headers;
  }

  for (const [key, value] of Object.entries(initHeaders)) {
    if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  return headers;
}

function shouldRouteToCodex(url: URL) {
  return (
    url.pathname.includes("/v1/responses") ||
    url.pathname.includes("/responses") ||
    url.pathname.includes("/chat/completions")
  );
}

async function fetchWithCodexOAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const session = await getValidOpenAiTokenInfo();

  if (!session.accessToken) {
    throw new Error("Missing OpenAI access token. Please connect ChatGPT first.");
  }

  const originalUrl =
    input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
  const requestUrl = shouldRouteToCodex(originalUrl)
    ? new URL(CODEX_RESPONSES_URL)
    : originalUrl;
  const headers = copyHeaders(init?.headers);

  headers.delete("authorization");
  headers.delete("Authorization");
  headers.set("authorization", `Bearer ${session.accessToken}`);
  headers.set("openai-originator", "opencode");

  if (session.accountId) {
    headers.set("ChatGPT-Account-Id", session.accountId);
  }

  return fetch(requestUrl, {
    ...init,
    headers,
  });
}

export async function createOpenAIClient(input: {
  provider: ProviderConfig;
  secretStore: SecretStore;
}) {
  if (input.provider.family === "openai" && input.provider.authType === "oauth") {
    return createOpenAI({
      apiKey: OAUTH_DUMMY_API_KEY,
      baseURL: "https://api.openai.com/v1",
      fetch: fetchWithCodexOAuth,
      name: "openai",
    });
  }

  const apiKey = await input.secretStore.getProviderApiKey(input.provider.id);

  if (!apiKey) {
    throw new Error(`Missing API key for provider ${input.provider.label}.`);
  }

  return createOpenAI({
    apiKey,
    baseURL:
      input.provider.baseUrl ||
      (input.provider.family === "openai"
        ? "https://api.openai.com/v1"
        : undefined),
    headers:
      input.provider.family === "openrouter"
        ? {
            "HTTP-Referer": "https://mobile-agent.local",
            "X-Title": "mobile-agent",
          }
        : undefined,
    name:
      input.provider.family === "openrouter"
        ? "openrouter"
        : input.provider.family === "openai-compatible"
          ? input.provider.id
          : undefined,
  });
}

export function getOpenAIProviderTools(
  model: ResolvedModel,
): Parameters<ModelRuntime["generateTextStream"]>[0]["tools"] {
  if (
    model.providerFamily !== "openai" ||
    model.transport !== "openaiResponses" ||
    !model.supportsImageGeneration
  ) {
    return undefined;
  }

  const provider = createOpenAI({
    apiKey: "tool-only",
  });

  return {
    imageGeneration: provider.tools.imageGeneration({
      background: "auto",
      moderation: "auto",
      outputFormat: "png",
      quality: "high",
      size: "auto",
    }),
  } as Parameters<ModelRuntime["generateTextStream"]>[0]["tools"];
}
