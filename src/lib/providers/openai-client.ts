import { createOpenAI } from "@ai-sdk/openai";
import { Platform } from "react-native";

import {
  getValidOpenAiTokenInfo,
  refreshOpenAIToken,
  setOpenAiTokens,
} from "@/lib/openai-oauth";
import { getOllamaOpenAIBaseUrl } from "@/lib/providers/ollama-models";
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

function buildCodexRequestInit(init?: RequestInit): RequestInit | undefined {
  if (typeof init?.body !== "string") {
    return init;
  }

  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    delete body.max_output_tokens;

    return {
      ...init,
      body: JSON.stringify({
        ...body,
        store: false,
      }),
    };
  } catch {
    return init;
  }
}

async function fetchWithCodexOAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let session = await getValidOpenAiTokenInfo();

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
  const requestInit = shouldRouteToCodex(originalUrl)
    ? buildCodexRequestInit(init)
    : init;
  const send = (accessToken: string, accountId: string | null) => {
    const headers = copyHeaders(
      requestInit?.headers ??
        (typeof input === "string" || input instanceof URL
          ? undefined
          : input.headers),
    );

    headers.delete("authorization");
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("originator", "opencode");
    headers.set("User-Agent", `mobile-agent/1.1.0 (${Platform.OS})`);

    if (accountId) {
      headers.set("ChatGPT-Account-Id", accountId);
    } else {
      headers.delete("ChatGPT-Account-Id");
    }

    return fetch(requestUrl, {
      ...requestInit,
      headers,
    });
  };

  let response = await send(session.accessToken, session.accountId);

  if (response.status === 401 && session.refreshToken) {
    const refreshed = await refreshOpenAIToken(session.refreshToken);

    await setOpenAiTokens({
      accessToken: refreshed.access_token,
      accountId: session.accountId,
      email: session.email,
      expiresIn: refreshed.expires_in ?? null,
      idToken: refreshed.id_token ?? null,
      refreshToken: refreshed.refresh_token ?? session.refreshToken,
    });
    session = await getValidOpenAiTokenInfo();

    if (!session.accessToken) {
      throw new Error("Session expired. Please connect ChatGPT again.");
    }

    response = await send(session.accessToken, session.accountId);
  }

  return response;
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

  const apiKey =
    input.provider.authType === "none"
      ? "ollama"
      : await input.secretStore.getProviderApiKey(input.provider.id);

  if (!apiKey) {
    throw new Error(`Missing API key for provider ${input.provider.label}.`);
  }

  return createOpenAI({
    apiKey,
    baseURL:
      input.provider.family === "ollama"
        ? getOllamaOpenAIBaseUrl(input.provider.baseUrl)
        : input.provider.baseUrl ||
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
          : input.provider.family === "ollama"
            ? "ollama"
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
