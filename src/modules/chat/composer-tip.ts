import bundledTip from "../../../catalog/chat-tip.json";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";

export const COMPOSER_TIP_URL =
  "https://raw.githubusercontent.com/tecnicalbot/mobile-agent/refs/heads/main/catalog/chat-tip.json";
export const COMPOSER_TIP_REFRESH_MS = 5 * 60 * 1000;
export const MAX_COMPOSER_TIP_LENGTH = 180;

export type ComposerTipPart = { text: string; url?: string };
export type ComposerTip = { enabled: boolean; parts: ComposerTipPart[] };

export function parseComposerTip(value: unknown): ComposerTip {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Chat tip must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.enabled !== "boolean") {
    throw new Error("Chat tip requires version 1 and an enabled boolean.");
  }
  if (!Array.isArray(record.parts) || record.parts.length > 8) {
    throw new Error("Chat tip must contain at most 8 text parts.");
  }

  const parts = record.parts.map((value): ComposerTipPart => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Chat tip part must be an object.");
    }
    const part = value as Record<string, unknown>;
    if (typeof part.text !== "string" || !part.text.trim()) {
      throw new Error("Chat tip part requires text.");
    }
    const text = part.text.replace(/\s+/g, " ");
    if (part.url === undefined) return { text };
    if (typeof part.url !== "string" || part.url.length > 2048) {
      throw new Error("Chat tip link is invalid.");
    }
    const url = new URL(part.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Chat tip links must be public HTTPS URLs.");
    }
    return { text, url: url.href };
  });

  const text = parts.map((part) => part.text).join("");
  if (text.length > MAX_COMPOSER_TIP_LENGTH || (record.enabled && !text.trim())) {
    throw new Error("Chat tip must contain 1–180 visible characters.");
  }
  return { enabled: record.enabled, parts };
}

export const DEFAULT_COMPOSER_TIP = parseComposerTip(bundledTip);

export async function fetchComposerTip(signal?: AbortSignal): Promise<ComposerTip> {
  const response = await fetchWithTimeout(COMPOSER_TIP_URL, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Chat tip request failed (${response.status}).`);
  }
  const body = await response.text();
  if (body.length > 16_384) throw new Error("Chat tip response is too large.");
  return parseComposerTip(JSON.parse(body));
}
