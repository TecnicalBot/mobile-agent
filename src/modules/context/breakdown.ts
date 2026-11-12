import type { ModelMessage, ToolSet } from "ai";

import type {
  ContextBreakdown,
  ContextBreakdownPart,
} from "@/core/types/app-state";

import { estimateMessagesTokens, estimateTokens } from "./token-estimator";

export type ContextBreakdownSource = {
  key: string;
  label: string;
  text?: string | null;
  tokens?: number;
  toolNames?: string[];
  tools?: ToolSet;
};

/**
 * Estimate the JSON schema footprint of a set of tool definitions. Only the
 * named tools are measured, which lets callers attribute tokens to the source
 * that contributed them (built-in, MCP, plugins, ...).
 */
export function estimateToolTokens(
  tools: ToolSet | undefined,
  names?: string[],
) {
  if (!tools) return 0;

  if (!names) {
    return Object.keys(tools).length > 0 ? estimateTokens(JSON.stringify(tools)) : 0;
  }

  const picked: Record<string, unknown> = {};
  for (const name of names) {
    if (name in tools) {
      picked[name] = tools[name];
    }
  }

  return Object.keys(picked).length > 0 ? estimateTokens(JSON.stringify(picked)) : 0;
}

function mergeParts(parts: ContextBreakdownPart[]) {
  const merged = new Map<string, ContextBreakdownPart>();

  for (const part of parts) {
    if (part.tokens <= 0) continue;

    const existing = merged.get(part.key);
    if (existing) {
      existing.tokens += part.tokens;
      continue;
    }

    merged.set(part.key, { ...part });
  }

  return [...merged.values()];
}

export function buildContextBreakdown(input: {
  contextWindow: number;
  messages: ModelMessage[];
  reserved: number;
  sources: ContextBreakdownSource[];
}): ContextBreakdown {
  const measured = input.sources.map((source) => ({
    key: source.key,
    label: source.label,
    tokens:
      source.tokens ??
      (source.tools
        ? estimateToolTokens(source.tools, source.toolNames)
        : estimateTokens(source.text ?? "")),
  }));

  const parts = mergeParts([
    ...measured,
    {
      key: "messages",
      label: "Messages",
      tokens: estimateMessagesTokens(input.messages),
    },
  ]);
  const usedTokens = parts.reduce((total, part) => total + part.tokens, 0);
  const reserved = Math.max(input.reserved, 0);
  const freeTokens = Math.max(input.contextWindow - usedTokens - reserved, 0);

  return {
    contextWindow: input.contextWindow,
    parts: [
      ...parts,
      ...(reserved > 0
        ? [
            {
              key: "reserved",
              label: "Output & safety reserve",
              tokens: reserved,
            },
          ]
        : []),
      { key: "free", label: "Free space", tokens: freeTokens },
    ],
    reserved,
    usedTokens,
  };
}
