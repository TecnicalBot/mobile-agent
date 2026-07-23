import type { ModelMessage, ToolSet } from "ai";

import type { ResolvedModel } from "@/types/app-state";

import { estimateMessagesTokens, estimateTokens } from "./token-estimator";

const DEFAULT_CONTEXT_WINDOW = 32_000;
const SAFETY_BUFFER = 2_000;
const DEFAULT_MAX_OUTPUT = 4_096;

export type ContextBudget = {
  contextWindow: number;
  reserved: number;
  systemTokens: number;
  toolDefinitionTokens: number;
  usable: number;
};

export function calculateContextBudget(input: {
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  systemPrompt?: string;
  tools?: ToolSet;
  model: ResolvedModel;
}): ContextBudget {
  const contextWindow = input.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const maxOutput = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT;
  const reservedOutput = Math.min(
    maxOutput,
    16_384,
    Math.max(256, Math.floor(contextWindow * 0.25)),
  );
  const safetyBuffer = Math.min(
    SAFETY_BUFFER,
    Math.max(128, Math.floor(contextWindow * 0.1)),
  );
  const reserved = reservedOutput + safetyBuffer;

  const systemTokens = input.systemPrompt
    ? estimateTokens(input.systemPrompt)
    : 0;

  let toolDefinitionTokens = 0;
  if (input.tools) {
    const toolJson = JSON.stringify(input.tools);
    toolDefinitionTokens = estimateTokens(toolJson);
  }

  const usable = Math.max(
    contextWindow - reserved - systemTokens - toolDefinitionTokens,
    0,
  );

  return {
    contextWindow,
    reserved,
    systemTokens,
    toolDefinitionTokens,
    usable,
  };
}

export function isOverflow(
  messages: ModelMessage[],
  budget: ContextBudget,
): boolean {
  const totalTokens = estimateMessagesTokens(messages);
  return totalTokens >= budget.usable;
}

export function getTokenUsage(
  messages: ModelMessage[],
  budget: ContextBudget,
): { total: number; usable: number; overBy: number; percent: number } {
  const total = estimateMessagesTokens(messages);
  const overBy = Math.max(total - budget.usable, 0);
  const percent =
    budget.usable > 0 ? Math.round((total / budget.usable) * 100) : 100;
  return { total, usable: budget.usable, overBy, percent };
}
