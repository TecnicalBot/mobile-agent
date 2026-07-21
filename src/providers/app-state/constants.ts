import {
  DEFAULT_BUILT_IN_TOOL_SETTINGS,
} from "@/lib/config/built-in-tools";
import type { AppSettings, AppStateSnapshot, ResolvedConfig } from "@/types/app-state";

export const REQUEST_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

export const BASE_AGENT_SYSTEM_PROMPT = [
  "You are Mobile Agent, a capable assistant that helps the user complete tasks on their device and in their selected workspace.",
  "Follow the user's request carefully and work toward a complete, useful result.",
  "Be accurate about what you know, what tools confirmed, and what actions were actually completed.",
  "Never claim that an external action or file change happened unless a tool result confirms it.",
  "Use the available context and tools when they materially help, while respecting approval and access boundaries.",
  "Ask a concise clarifying question only when a missing choice would materially change the result; otherwise make reasonable assumptions and proceed.",
  "Keep user-facing responses clear and concise unless the task calls for more detail.",
].join("\n\n");

export function buildCurrentDateTimeSystemPrompt() {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return [
    `Current date and time: ${now.toLocaleString()}.`,
    `Current time zone: ${timeZone || "device local time"}.`,
    "Use this as the reference for relative dates such as today, tomorrow, and yesterday.",
  ].join("\n");
}

export function buildConversationTitle(input: string) {
  const normalized = input.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "New chat";
  }

  return normalized.length > 48
    ? `${normalized.slice(0, 48).trim()}...`
    : normalized;
}

export function normalizeGeneratedConversationTitle(text: string, fallback: string) {
  const title = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[#*\-\s"'`]+|[#*\-\s"'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) return fallback;
  return title.length > 60 ? `${title.slice(0, 57).trim()}...` : title;
}

export const EMPTY_SETTINGS: AppSettings = {
  activeConversationId: null,
  activeModelRef: null,
  builtInToolSettings: DEFAULT_BUILT_IN_TOOL_SETTINGS,
  databaseMode: "local",
  databaseUrl: null,
  memoryEnabled: true,
  maxToolSteps: 50,
  themeMode: "system",
  toolApprovalMode: "ask",
};

export const EMPTY_RESOLVED_CONFIG: ResolvedConfig = {
  activeProviderIds: [],
  providers: [],
  modelPresets: [],
  suggestedModelsByProvider: {},
  providerModelDiscovery: {},
  availableModels: [],
  activeModels: [],
  currentModel: null,
  currentModelSupportsImageGeneration: false,
  currentModelSupportsImageInput: false,
  currentModelSupportsTools: false,
  databaseMode: "local",
  databaseUrl: null,
};

export const EMPTY_SNAPSHOT: AppStateSnapshot = {
  agentRuns: [],
  conversations: [],
  currentConversation: null,
  currentSelectedFileIds: [],
  currentSelectedSkillIds: [],
  memory: null,
  mcpServers: [],
  messages: [],
  skills: [],
  workspaceFiles: [],
  resolvedConfig: EMPTY_RESOLVED_CONFIG,
  settings: EMPTY_SETTINGS,
};
