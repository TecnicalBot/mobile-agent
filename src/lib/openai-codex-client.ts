import {
  getValidOpenAiTokenInfo,
  refreshOpenAIToken,
  setOpenAiTokens,
} from "@/lib/openai-oauth";
import type { LanguageModelUsage, ModelMessage } from "ai";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

type TextStreamParams = {
  abortSignal?: AbortSignal;
  model?: string;
  messages: ModelMessage[];
  onDelta?: (delta: string) => void;
  onEvent?: (eventName: string | null, data: any) => void;
};

type CodexRequestOptions = {
  accountId?: string | null;
  accessToken: string;
  abortSignal?: AbortSignal;
  model: string;
  messages: ModelMessage[];
  onDelta?: (delta: string) => void;
  onEvent?: (eventName: string | null, data: any) => void;
};

type CodexStreamResult = {
  text: string;
  usage?: LanguageModelUsage;
};

export async function generateCodexTextStream(params: TextStreamParams) {
  let session = await getValidOpenAiTokenInfo();
  let accessToken = session.accessToken;
  let refreshToken = session.refreshToken;

  if (!accessToken && refreshToken) {
    const refreshed = await refreshOpenAIToken(refreshToken);

    await setOpenAiTokens({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? refreshToken,
    });

    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token ?? refreshToken;
    session = await getValidOpenAiTokenInfo();
  }

  if (!accessToken) {
    throw new Error("Missing OpenAI access token. Please login first.");
  }

  const model = params.model ?? "gpt-5.5";

  try {
    return await streamCodexResponse({
      accountId: session.accountId,
      accessToken,
      abortSignal: params.abortSignal,
      messages: params.messages,
      model,
      onDelta: params.onDelta,
      onEvent: params.onEvent,
    });
  } catch (error: any) {
    const message = String(error?.message || error);

    // Refresh token if access token expired
    if (
      message.includes("401") ||
      message.includes("Unauthorized") ||
      message.includes("access token")
    ) {
      refreshToken = refreshToken ?? (await getValidOpenAiTokenInfo()).refreshToken;

      if (!refreshToken) {
        throw new Error("Session expired. Please login again.");
      }

      const refreshed = await refreshOpenAIToken(refreshToken);

      await setOpenAiTokens({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
      });
      session = await getValidOpenAiTokenInfo();

      return await streamCodexResponse({
        accountId: session.accountId,
        accessToken: refreshed.access_token,
        abortSignal: params.abortSignal,
        messages: params.messages,
        model,
        onDelta: params.onDelta,
        onEvent: params.onEvent,
      });
    }

    throw error;
  }
}

function streamCodexResponse(params: CodexRequestOptions): Promise<CodexStreamResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    let lastIndex = 0;
    let finalText = "";
    let latestUsage: LanguageModelUsage | undefined;
    let completed = false;
    let settled = false;

    xhr.open("POST", CODEX_RESPONSES_URL);

    xhr.setRequestHeader("Authorization", `Bearer ${params.accessToken}`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "text/event-stream");

    // Keep this close to OpenCode/Codex behavior
    xhr.setRequestHeader("openai-originator", "opencode");
    if (params.accountId) {
      xhr.setRequestHeader("ChatGPT-Account-Id", params.accountId);
    }

    xhr.onreadystatechange = () => {
      /**
       * readyState 3 = streaming / receiving
       * readyState 4 = complete
       */
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        const chunk = xhr.responseText.slice(lastIndex);
        lastIndex = xhr.responseText.length;

        if (chunk) {
          const parsedText = parseSSEChunk(chunk, {
            onEvent: params.onEvent,
            onDelta: params.onDelta,
            onUsage: (usage) => {
              latestUsage = usage;
            },
          });

          if (parsedText) {
            finalText += parsedText;
          }
        }
      }

      if (xhr.readyState === 4) {
        completed = true;
        settled = true;

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            text: finalText,
            usage: latestUsage,
          });
        } else {
          reject(
            new Error(
              `Codex request failed ${xhr.status}: ${xhr.responseText}`,
            ),
          );
        }
      }
    };

    xhr.onerror = () => {
      if (!completed && !settled) {
        settled = true;
        reject(new Error("Codex stream network error"));
      }
    };

    xhr.ontimeout = () => {
      settled = true;
      reject(new Error("Codex stream timeout"));
    };

    const handleAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      completed = true;
      xhr.abort();
      reject(new Error("Request aborted."));
    };

    if (params.abortSignal?.aborted) {
      handleAbort();
      return;
    }

    params.abortSignal?.addEventListener("abort", handleAbort, { once: true });

    xhr.timeout = 120000;

    const input = modelMessagesToCodexInput(params.messages);

    xhr.send(
      JSON.stringify({
        model: params.model,
        // Required by this endpoint
        store: false,
        // Required by this endpoint
        stream: true,
        input,
      }),
    );
  });
}

function parseSSEChunk(
  chunk: string,
  handlers: {
    onDelta?: (delta: string) => void;
    onEvent?: (eventName: string | null, data: any) => void;
    onUsage?: (usage: LanguageModelUsage) => void;
  },
) {
  const blocks = chunk
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  let collectedText = "";

  for (const block of blocks) {
    const lines = block.split("\n");

    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLines = lines.filter((line) => line.startsWith("data:"));

    const eventName = eventLine ? eventLine.replace("event:", "").trim() : null;

    const dataRaw = dataLines
      .map((line) => line.replace("data:", "").trim())
      .join("\n");

    if (!dataRaw || dataRaw === "[DONE]") continue;

    try {
      const data = JSON.parse(dataRaw);

      handlers.onEvent?.(eventName, data);

      const usage = extractUsage(data);

      if (usage) {
        handlers.onUsage?.(usage);
      }

      const delta = extractTextDelta(eventName, data);

      if (delta) {
        collectedText += delta;
        handlers.onDelta?.(delta);
      }
    } catch {
      // ignore partial / malformed blocks
    }
  }

  return collectedText;
}

function normalizeUsageObject(
  usage:
    | Record<string, unknown>
    | null
    | undefined,
): LanguageModelUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = getNumberField(usage, ["input_tokens", "prompt_tokens"]);
  const outputTokens = getNumberField(usage, [
    "output_tokens",
    "completion_tokens",
  ]);
  const totalTokens = getNumberField(usage, ["total_tokens"]);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens:
      totalTokens ??
      (inputTokens != null || outputTokens != null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined),
    raw: usage as LanguageModelUsage["raw"],
  };
}

function getNumberField(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function extractUsage(data: unknown): LanguageModelUsage | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const direct = normalizeUsageObject(
    record.usage && typeof record.usage === "object"
      ? (record.usage as Record<string, unknown>)
      : null,
  );

  if (direct) {
    return direct;
  }

  const response = record.response;

  if (response && typeof response === "object") {
    return normalizeUsageObject(
      (response as Record<string, unknown>).usage &&
        typeof (response as Record<string, unknown>).usage === "object"
        ? ((response as Record<string, unknown>).usage as Record<string, unknown>)
        : null,
    );
  }

  return undefined;
}

function extractTextDelta(eventName: string | null, data: any): string {
  if (!data) return "";

  if (
    eventName === "response.output_text.delta" ||
    data.type === "response.output_text.delta"
  ) {
    return typeof data.delta === "string" ? data.delta : "";
  }

  if (
    eventName === "response.text.delta" ||
    data.type === "response.text.delta"
  ) {
    return typeof data.delta === "string" ? data.delta : "";
  }

  return "";
}

function modelMessagesToCodexInput(messages: ModelMessage[]) {
  return messages.map((message) => {
    const role =
      message.role === "assistant"
        ? "assistant"
        : message.role === "system"
          ? "system"
          : "user";

    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);

    return {
      role,
      content: [
        {
          type: role === "assistant" ? "output_text" : "input_text",
          text: content,
        },
      ],
    };
  });
}
