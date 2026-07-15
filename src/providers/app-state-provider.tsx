import type { ModelMessage, ToolSet } from "ai";
import type { DocumentPickerAsset } from "expo-document-picker";
import { useSQLiteContext } from "expo-sqlite";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AppState,
  Platform,
  useColorScheme as useSystemColorScheme,
} from "react-native";
import { colorScheme } from "nativewind";

import {
  BUILT_IN_FILE_TOOL_CONTROLS,
  DEFAULT_BUILT_IN_TOOL_SETTINGS,
} from "@/lib/config/built-in-tools";
import {
  fetchLiveModelCatalogCached,
  getCatalogModelDefinitionsForProvider,
  type LiveCatalogModel,
} from "@/lib/config/live-model-catalog";
import {
  fetchModelsDevCatalogCached,
  getModelsDevDefinitionsForProvider,
} from "@/lib/config/models-dev-catalog";
import { fetchOllamaModels } from "@/lib/providers/ollama-models";
import { resolveConfiguredModel } from "@/lib/config/registry";
import { createRepositories } from "@/lib/db/database";
import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { connectMcpOAuth } from "@/lib/mcp/oauth";
import {
  createMcpRuntimeTools,
  testMcpServerConnection,
} from "@/lib/mcp/runtime-tools";
import {
  notifyRunFinishedAsync,
  prepareRunNotificationsAsync,
} from "@/lib/notifications/run-notifications";
import {
  clearOpenAiTokens,
  getOpenAiAccessToken,
  getOpenAiRefreshToken,
  getOpenAiTokenInfo,
  handleLogin,
} from "@/lib/openai-oauth";
import {
  convertStoredMessagesToModelMessages,
  partitionSelectedFiles,
} from "@/lib/runtime/message-conversion";
import { modelRuntime } from "@/lib/runtime/model-runtime";
import {
  buildModelPromptArtifact,
  buildToolContextArtifact,
  buildToolExecutionArtifact,
  createExecutionTimelineEvent,
  createPromptArtifactRecord,
} from "@/lib/runtime/run-artifacts";
import {
  buildRunStatusByConversation,
  createPendingToolApproval,
  createRunControllerRegistry,
  isActiveAgentRunStatus,
  shouldAutoResumeRun,
  type ToolApprovalDecision,
} from "@/lib/runtime/run-manager";
import { wrapToolsWithApproval } from "@/lib/runtime/tool-approval";
import { secureSecretStore } from "@/lib/secrets";
import { summarizeValue } from "@/lib/tools/built-in/shared";
import {
  buildExternalFolderSystemPrompt,
  createExternalFolderTools,
} from "@/lib/tools/external-folder-tools";
import { persistGeneratedImages } from "@/lib/tools/generated-images";
import {
  buildMemorySystemPrompt,
  createMemoryTools,
} from "@/lib/tools/memory-tools";
import {
  buildSelectedFilesInlineContext,
  createWorkspaceTools,
} from "@/lib/tools/workspace-tools";
import { createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";
import type {
  AgentRun,
  AppSettings,
  AppStateSnapshot,
  BuiltInToolSettings,
  Conversation,
  CuratedModelDefinition,
  ExecutionTimelineEvent,
  ExternalFolderSession,
  FileContextSource,
  McpServerAuthMode,
  McpServerConfig,
  McpServerTransport,
  MemoryEntry,
  MemoryEvent,
  MessageMetadata,
  ModelPreset,
  ModelRef,
  ModelUsageSnapshot,
  PendingToolApproval,
  PendingToolApprovalRequest,
  PromptArtifact,
  ProviderConfig,
  ReasoningBlock,
  ResolvedConfig,
  ResolvedModel,
  SendMessageInput,
  SkillConfig,
  StoredMessage,
  ToolExecutionRecord,
  WorkspaceFile,
} from "@/types/app-state";
import { createModelRef } from "@/types/app-state";

type AppStateContextValue = {
  approvePendingToolApproval: () => void;
  agentRuns: AgentRun[];
  cancelRun: (input?: {
    conversationId?: string;
    runId?: string;
  }) => Promise<void>;
  clearProviderApiKey: (providerId: string) => Promise<void>;
  clearWorkspaceFiles: () => Promise<void>;
  deleteWorkspaceFile: (fileId: string) => Promise<void>;
  clearMcpServerCredentials: (serverId: string) => Promise<void>;
  connectOpenAIOAuth: () => Promise<void>;
  connectMcpServerOAuth: (serverId: string) => Promise<void>;
  createMcpServer: (input: {
    authMode: McpServerAuthMode;
    enabled?: boolean;
    headerValues?: Record<string, string>;
    label: string;
    oauthAllowedAuthOrigin?: string | null;
    oauthAuthorizationUrl?: string | null;
    oauthClientId?: string | null;
    oauthScopes?: string | null;
    oauthTokenUrl?: string | null;
    transport: McpServerTransport;
    url: string;
  }) => Promise<McpServerConfig>;
  createProvider: (input: {
    authType: ProviderConfig["authType"];
    baseUrl?: string | null;
    family: ProviderConfig["family"];
    id: string;
    label: string;
    oauthAccountEmail?: string | null;
  }) => Promise<ProviderConfig>;
  createConversation: () => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  createWorkspaceFile: (input: {
    content: string;
    name: string;
  }) => Promise<WorkspaceFile>;
  createModelPreset: (input: {
    label?: string | null;
    makeDefault?: boolean;
    modelId: string;
    options?: Record<string, unknown> | null;
    providerId: string;
    select?: boolean;
  }) => Promise<void>;
  createSkill: (input: {
    autoMatch?: boolean;
    description?: string | null;
    enabled?: boolean;
    instructions: string;
    matchKeywords?: string[];
    recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
    recommendedMcpServerIds?: string[];
    title: string;
  }) => Promise<SkillConfig>;
  createMemory: (input: {
    content: string;
    enabled?: boolean;
  }) => Promise<MemoryEntry>;
  currentConversation: Conversation | null;
  currentExternalFolderSession: ExternalFolderSession | null;
  pendingToolApproval: PendingToolApproval | null;
  denyPendingToolApproval: () => void;
  deleteMcpServer: (serverId: string) => Promise<void>;
  dismissInAppNotification: () => void;
  deleteModelPreset: (modelPresetId: string) => Promise<void>;
  deleteMemory: (memoryId: string) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
  disconnectOpenAIOAuth: () => Promise<void>;
  error: string | null;
  hydrating: boolean;
  importFiles: (assets: DocumentPickerAsset[]) => Promise<WorkspaceFile[]>;
  inAppNotification: {
    body: string;
    conversationId: string;
    id: string;
    title: string;
  } | null;
  currentSelectedFileIds: string[];
  currentSelectedSkillIds: string[];
  memories: MemoryEntry[];
  messages: StoredMessage[];
  mcpServers: McpServerConfig[];
  resumePendingRuns: () => Promise<void>;
  runStatusByConversation: Record<string, AgentRun["status"] | null>;
  pickConversationFolder: () => Promise<ExternalFolderSession>;
  clearConversationFolder: () => Promise<void>;
  ready: boolean;
  refresh: () => Promise<void>;
  refreshWorkspaceFiles: () => Promise<void>;
  resolvedConfig: ResolvedConfig;
  saveProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  saveMcpServerHeaderValues: (
    serverId: string,
    headers: Record<string, string>,
  ) => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  selectModel: (modelRef: ModelRef) => Promise<void>;
  sendMessage: (input: SendMessageInput) => Promise<void>;
  sending: boolean;
  stopSending: () => Promise<void>;
  setCurrentSelectedFileIds: (selectedFileIds: string[]) => Promise<void>;
  setCurrentSelectedSkillIds: (selectedSkillIds: string[]) => Promise<void>;
  setDefaultModelPreset: (modelPresetId: string) => Promise<void>;
  settings: AppSettings;
  testMcpServer: (serverId: string) => Promise<void>;
  conversations: Conversation[];
  updateMcpServer: (
    serverId: string,
    input: {
      authMode?: McpServerAuthMode;
      enabled?: boolean;
      headerValues?: Record<string, string>;
      label?: string;
      oauthAllowedAuthOrigin?: string | null;
      oauthAuthorizationUrl?: string | null;
      oauthClientId?: string | null;
      oauthScopes?: string | null;
      oauthTokenUrl?: string | null;
      transport?: McpServerTransport;
      url?: string;
    },
  ) => Promise<void>;
  updateDatabaseSettings: (input: {
    databaseMode?: AppSettings["databaseMode"];
    databaseUrl?: string | null;
  }) => Promise<void>;
  updateBuiltInToolSettings: (
    input: Partial<BuiltInToolSettings>,
  ) => Promise<void>;
  updateMemory: (
    memoryId: string,
    input: {
      content?: string;
      enabled?: boolean;
    },
  ) => Promise<void>;
  updateMemoryEnabled: (enabled: boolean) => Promise<void>;
  updateToolApprovalMode: (
    mode: AppSettings["toolApprovalMode"],
  ) => Promise<void>;
  updateMaxToolSteps: (maxToolSteps: number) => Promise<void>;
  updateThemeMode: (mode: AppSettings["themeMode"]) => Promise<void>;
  updateProvider: (
    providerId: string,
    input: {
      baseUrl?: string | null;
      enabled?: boolean;
      label?: string;
      oauthAccountEmail?: string | null;
    },
  ) => Promise<void>;
  updateSkill: (
    skillId: string,
    input: {
      autoMatch?: boolean;
      description?: string | null;
      enabled?: boolean;
      instructions?: string;
      matchKeywords?: string[];
      recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
      recommendedMcpServerIds?: string[];
      title?: string;
    },
  ) => Promise<void>;
  skills: SkillConfig[];
  workspaceFiles: WorkspaceFile[];
};

type AppStateProviderProps = {
  children: ReactNode;
};

const EMPTY_SETTINGS: AppSettings = {
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

function ThemePreferenceController({
  mode,
}: {
  mode: AppSettings["themeMode"];
}) {
  const systemColorScheme = useSystemColorScheme();

  useEffect(() => {
    colorScheme.set(
      Platform.OS === "web" && mode === "system"
        ? systemColorScheme === "dark"
          ? "dark"
          : "light"
        : mode,
    );
  }, [mode, systemColorScheme]);

  return null;
}

const EMPTY_RESOLVED_CONFIG: ResolvedConfig = {
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

const EMPTY_SNAPSHOT: AppStateSnapshot = {
  agentRuns: [],
  conversations: [],
  currentConversation: null,
  currentSelectedFileIds: [],
  currentSelectedSkillIds: [],
  memories: [],
  mcpServers: [],
  messages: [],
  skills: [],
  workspaceFiles: [],
  resolvedConfig: EMPTY_RESOLVED_CONFIG,
  settings: EMPTY_SETTINGS,
};

const AppStateContext = createContext<AppStateContextValue | null>(null);
const REQUEST_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

const BASE_AGENT_SYSTEM_PROMPT = [
  "You are Mobile Agent, a capable assistant that helps the user complete tasks on their device and in their selected workspace.",
  "Follow the user's request carefully and work toward a complete, useful result.",
  "Be accurate about what you know, what tools confirmed, and what actions were actually completed.",
  "Never claim that an external action or file change happened unless a tool result confirms it.",
  "Use the available context and tools when they materially help, while respecting approval and access boundaries.",
  "Ask a concise clarifying question only when a missing choice would materially change the result; otherwise make reasonable assumptions and proceed.",
  "Keep user-facing responses clear and concise unless the task calls for more detail.",
].join("\n\n");

function buildCurrentDateTimeSystemPrompt() {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return [
    `Current date and time: ${now.toLocaleString()}.`,
    `Current time zone: ${timeZone || "device local time"}.`,
    "Use this as the reference for relative dates such as today, tomorrow, and yesterday.",
  ].join("\n");
}

function buildConversationTitle(input: string) {
  const normalized = input.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "New chat";
  }

  return normalized.length > 48
    ? `${normalized.slice(0, 48).trim()}...`
    : normalized;
}

function normalizeGeneratedConversationTitle(text: string, fallback: string) {
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

function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function upsertConversation(
  conversations: Conversation[],
  conversation: Conversation,
) {
  const nextConversations = conversations.filter(
    (item) => item.id !== conversation.id,
  );

  nextConversations.push(conversation);

  return sortConversations(nextConversations);
}

function upsertAgentRun(agentRuns: AgentRun[], agentRun: AgentRun) {
  const nextRuns = agentRuns.filter((item) => item.id !== agentRun.id);

  nextRuns.push(agentRun);

  return nextRuns.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function sortMessages(messages: StoredMessage[]) {
  return [...messages].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function buildMessageDebugSummary(messages: StoredMessage[]) {
  return {
    count: messages.length,
    tail: messages.slice(-4).map((message) => ({
      contentLength: message.content.length,
      id: message.id,
      role: message.role,
      sequence: message.sequence,
      status: message.status,
    })),
  };
}

function logMessageDebug(label: string, data: Record<string, unknown>) {
  if (!__DEV__) {
    return;
  }
}

function upsertMessages(
  currentMessages: StoredMessage[],
  nextMessages: StoredMessage[],
) {
  const map = new Map(currentMessages.map((message) => [message.id, message]));

  for (const message of nextMessages) {
    map.set(message.id, message);
  }

  return sortMessages([...map.values()]);
}

function upsertWorkspaceFiles(
  currentFiles: WorkspaceFile[],
  nextFiles: WorkspaceFile[],
) {
  const map = new Map(currentFiles.map((file) => [file.id, file]));

  for (const file of nextFiles) {
    map.set(file.id, file);
  }

  return [...map.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function appendContextToLatestUserMessage(
  messages: ModelMessage[],
  context: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role !== "user") {
      continue;
    }

    messages[index] = {
      ...message,
      content:
        typeof message.content === "string"
          ? [message.content, context].filter(Boolean).join("\n\n")
          : [...message.content, { type: "text", text: context }],
    } as ModelMessage;
    return;
  }
}

function resolveFileContextSource(input: {
  currentConversation: Conversation | null;
  fileContextSource?: FileContextSource;
  selectedFileIds: string[];
}) {
  if (input.fileContextSource) {
    return input.fileContextSource;
  }

  if (input.selectedFileIds.length > 0) {
    return "workspace" satisfies FileContextSource;
  }

  if (input.currentConversation?.externalFolderSession) {
    return "external-folder" satisfies FileContextSource;
  }

  return "workspace" satisfies FileContextSource;
}

function filterToolsBySettings<T extends Record<string, unknown>>(
  tools: T,
  entries: Array<[keyof T, boolean]>,
) {
  return Object.fromEntries(
    entries
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key as string, tools[key]]),
  ) as Partial<T>;
}

function hasEnabledWorkspaceTools(settings: BuiltInToolSettings) {
  return (
    settings.workspaceCreateFile ||
    settings.workspaceListFiles ||
    settings.workspaceReadFile ||
    settings.workspaceWriteFile
  );
}

function hasEnabledFolderTools(settings: BuiltInToolSettings) {
  return (
    settings.folderCreateDirectory ||
    settings.folderCreateFile ||
    settings.folderDeleteEntry ||
    settings.folderListDirectory ||
    settings.folderMoveEntry ||
    settings.folderReadFile ||
    settings.folderRenameEntry ||
    settings.folderWriteFile
  );
}

function normalizeApprovalPath(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().replace(/\\/g, "/");

  if (!normalized || normalized === ".") {
    return "";
  }

  return normalized.replace(/^\.\/+/, "");
}

function buildExternalToolApprovalSummary(
  session: ExternalFolderSession,
  toolName: string,
  toolInput: unknown,
) {
  const input =
    toolInput && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>)
      : {};
  const relativePath = normalizeApprovalPath(input.path);
  const target = relativePath
    ? `${session.displayName}/${relativePath}`
    : session.displayName;

  if (toolName === "listDirectory") {
    return `List files in ${target}`;
  }

  if (toolName === "readFile") {
    return `Read ${target}`;
  }

  if (toolName === "writeFile") {
    return `Write to ${target}`;
  }

  if (toolName === "createFile") {
    return `Create file in ${target}`;
  }

  if (toolName === "createDirectory") {
    return `Create folder in ${target}`;
  }

  if (toolName === "renameEntry") {
    const newName =
      typeof input.newName === "string" && input.newName.trim()
        ? input.newName.trim()
        : "new name";

    return `Rename ${target} to ${newName}`;
  }

  if (toolName === "moveEntry") {
    const destination = normalizeApprovalPath(input.destinationPath);

    return destination
      ? `Move ${target} to ${session.displayName}/${destination}`
      : `Move ${target}`;
  }

  if (toolName === "deleteEntry") {
    return `Delete ${target}`;
  }

  return `${toolName} on ${target}`;
}

function summarizeToolInput(toolInput: unknown) {
  return summarizeValue(toolInput);
}

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase();
}

function getMatchWords(value: string) {
  return normalizeMatchText(value)
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length >= 4);
}

function skillMatchesInput(skill: SkillConfig, input: string) {
  if (!skill.enabled || !skill.autoMatch) {
    return false;
  }

  const normalizedInput = normalizeMatchText(input);

  if (!normalizedInput) {
    return false;
  }

  const explicitKeywordMatch = skill.matchKeywords.some((keyword) => {
    const normalizedKeyword = normalizeMatchText(keyword);

    return normalizedKeyword && normalizedInput.includes(normalizedKeyword);
  });

  if (explicitKeywordMatch) {
    return true;
  }

  return getMatchWords(skill.description ?? "").some((word) =>
    normalizedInput.includes(word),
  );
}

function resolveAppliedSkills(input: {
  content: string;
  selectedSkillIds: string[];
  skills: SkillConfig[];
}) {
  const selectedSkillIdSet = new Set(input.selectedSkillIds);
  const applied = input.skills.filter(
    (skill) =>
      skill.enabled &&
      (selectedSkillIdSet.has(skill.id) ||
        skillMatchesInput(skill, input.content)),
  );
  const seen = new Set<string>();

  return applied.filter((skill) => {
    if (seen.has(skill.id)) {
      return false;
    }

    seen.add(skill.id);
    return true;
  });
}

function buildSkillsSystemPrompt(input: {
  builtInToolSettings: BuiltInToolSettings;
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
}) {
  if (input.skills.length === 0) {
    return undefined;
  }

  const enabledMcpServerIds = new Set(
    input.mcpServers
      .filter((server) => server.enabled)
      .map((server) => server.id),
  );
  const mcpServerLabelById = new Map(
    input.mcpServers.map((server) => [server.id, server.label]),
  );
  const builtInToolLabelByKey = new Map(
    BUILT_IN_FILE_TOOL_CONTROLS.flatMap((control) =>
      control.keys.map((key) => [key, control.label] as const),
    ),
  );
  const sections = input.skills.map((skill) => {
    const disabledMcpServers = skill.recommendedMcpServerIds
      .filter((serverId) => !enabledMcpServerIds.has(serverId))
      .map((serverId) => mcpServerLabelById.get(serverId) ?? serverId);
    const disabledBuiltInTools = skill.recommendedBuiltInToolKeys
      .filter((toolKey) => !input.builtInToolSettings[toolKey])
      .map((toolKey) => builtInToolLabelByKey.get(toolKey) ?? toolKey);
    const recommendationNotes = [
      disabledMcpServers.length > 0
        ? `Recommended MCP servers not enabled: ${disabledMcpServers.join(", ")}.`
        : null,
      disabledBuiltInTools.length > 0
        ? `Recommended built-in tools not enabled: ${disabledBuiltInTools.join(", ")}.`
        : null,
    ].filter(Boolean);

    return [
      `Skill: ${skill.title}`,
      skill.description?.trim()
        ? `Description: ${skill.description.trim()}`
        : null,
      `Instructions:\n${skill.instructions.trim()}`,
      recommendationNotes.length > 0
        ? `Tool notes: ${recommendationNotes.join(" ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return ["Skills:", ...sections].join("\n\n");
}

function normalizeMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildUsageSnapshot(input: {
  model: ResolvedModel;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}) {
  return {
    providerId: input.model.providerId,
    providerLabel: input.model.providerLabel,
    modelId: input.model.modelId,
    modelLabel: input.model.label,
    inputTokens: normalizeMetric(input.usage?.inputTokens),
    outputTokens: normalizeMetric(input.usage?.outputTokens),
    totalTokens: normalizeMetric(input.usage?.totalTokens),
    costInput: null,
    costOutput: null,
    costTotal: null,
    contextWindow: null,
    remainingContext: null,
    contextUsagePercent: null,
  } satisfies ModelUsageSnapshot;
}

function buildAssistantMetadata(input: {
  appliedSkillIds?: string[];
  executionTimeline?: ExecutionTimelineEvent[];
  generatedImages?: MessageMetadata["generatedImages"];
  memoryEvents?: MemoryEvent[];
  promptArtifacts?: PromptArtifact[];
  reasoning?: ReasoningBlock[];
  runId?: string | null;
  toolExecutions: ToolExecutionRecord[];
  usage?: ModelUsageSnapshot | null;
}) {
  const metadata: MessageMetadata = {};

  if (input.runId) {
    metadata.runId = input.runId;
  }

  if (input.appliedSkillIds && input.appliedSkillIds.length > 0) {
    metadata.appliedSkillIds = input.appliedSkillIds;
  }

  if (input.executionTimeline && input.executionTimeline.length > 0) {
    metadata.executionTimeline = input.executionTimeline;
  }

  if (input.generatedImages && input.generatedImages.length > 0) {
    metadata.generatedImages = input.generatedImages;
  }

  if (input.memoryEvents && input.memoryEvents.length > 0) {
    metadata.memoryEvents = input.memoryEvents;
  }

  if (input.promptArtifacts && input.promptArtifacts.length > 0) {
    metadata.promptArtifacts = input.promptArtifacts;
  }

  if (input.reasoning && input.reasoning.length > 0) {
    metadata.reasoning = input.reasoning;
  }

  if (input.toolExecutions.length > 0) {
    metadata.toolExecutions = input.toolExecutions;
  }

  if (input.usage) {
    metadata.usage = input.usage;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function buildAssistantTextFromToolExecutions(
  toolExecutions: ToolExecutionRecord[],
) {
  const completed = toolExecutions.filter(
    (record) => record.status === "completed",
  );

  if (completed.length === 0) {
    return "";
  }

  const latest = completed[completed.length - 1];

  if (latest.toolName === "listDirectory" && latest.outputSummary) {
    try {
      const parsed = JSON.parse(latest.outputSummary) as {
        entries?: Array<{ kind?: string; name?: string; path?: string }>;
      };
      const entries = parsed.entries ?? [];

      if (entries.length === 0) {
        return "The folder is empty.";
      }

      return [
        "Here’s what I found:",
        ...entries.slice(0, 20).map((entry) => {
          const label = entry.name || entry.path || "Untitled";
          return `- ${label}${entry.kind === "directory" ? "/" : ""}`;
        }),
      ].join("\n");
    } catch {}
  }

  if (latest.toolName === "readFile" && latest.outputSummary) {
    try {
      const parsed = JSON.parse(latest.outputSummary) as {
        contentPreview?: string;
      };

      if (parsed.contentPreview?.trim()) {
        return parsed.contentPreview.trim();
      }
    } catch {}
  }

  if (latest.outputSummary?.trim()) {
    return latest.outputSummary.trim();
  }

  return `Completed ${latest.toolName}.`;
}

function describePromptArtifactLocation(artifact: PromptArtifact) {
  return `${artifact.relativePath} (${artifact.displayName})`;
}

const CODEX_OAUTH_MODELS = new Set(["gpt-5.5"]);

function isCodexOAuthModel(modelId: string) {
  if (CODEX_OAUTH_MODELS.has(modelId)) {
    return true;
  }

  const version = modelId.match(/^gpt-(\d+\.\d+)/)?.[1];
  return version ? Number(version) > 5.4 : false;
}

async function resolveConfig(input: {
  modelPresets: ModelPreset[];
  providers: ProviderConfig[];
  settings: AppSettings;
}) {
  const providerCredentialMap = new Map<string, boolean>();

  for (const provider of input.providers) {
    providerCredentialMap.set(
      provider.id,
      await secureSecretStore.hasProviderCredential(provider),
    );
  }

  const activeProviderIds = input.providers
    .filter((provider) => providerCredentialMap.get(provider.id) === true)
    .map((provider) => provider.id);
  let liveCatalog: LiveCatalogModel[] = [];
  let modelsDevCatalog = {};
  const ollamaModelsByProvider: Record<string, CuratedModelDefinition[]> = {};
  const providerModelDiscovery: ResolvedConfig["providerModelDiscovery"] = {};
  const needsModelsDevCatalog = input.providers.some(
    (provider) =>
      activeProviderIds.includes(provider.id) &&
      provider.family === "openai-compatible" &&
      provider.id !== "openai-compatible",
  );

  await Promise.all([
    fetchLiveModelCatalogCached()
      .then((catalog) => {
        liveCatalog = catalog;
      })
      .catch((error) => {
        console.warn("Failed to load the AI Gateway model catalog.", error);
      }),
    needsModelsDevCatalog
      ? fetchModelsDevCatalogCached()
          .then((catalog) => {
            modelsDevCatalog = catalog;
          })
          .catch((error) => {
            console.warn("Failed to load the models.dev catalog.", error);
          })
      : Promise.resolve(),
    ...input.providers
      .filter(
        (provider) =>
          provider.family === "ollama" &&
          activeProviderIds.includes(provider.id),
      )
      .map(async (provider) => {
        try {
          ollamaModelsByProvider[provider.id] =
            await fetchOllamaModels(provider);
          providerModelDiscovery[provider.id] = {
            error: null,
            status: "connected",
          };
        } catch (error) {
          console.warn("Failed to discover Ollama models.", error);
          providerModelDiscovery[provider.id] = {
            error:
              error instanceof Error && error.name === "AbortError"
                ? "Connection timed out. Check the server address and network access."
                : error instanceof Error
                  ? error.message
                  : "Could not connect to Ollama.",
            status: "failed",
          };
        }
      }),
  ]);

  const suggestedModelsByProvider = Object.fromEntries(
    input.providers.map((provider) => {
      const builtInModels: CuratedModelDefinition[] =
        provider.family === "openai" && provider.authType === "oauth"
          ? [
              {
                id: "gpt-5.5",
                kind: "chat",
                label: "GPT-5.5",
                capabilities: { tools: true },
              },
              {
                id: "gpt-5.4",
                kind: "chat",
                label: "GPT-5.4",
                capabilities: { tools: true },
              },
              {
                id: "gpt-5.4-mini",
                kind: "small",
                label: "GPT-5.4 mini",
                capabilities: { tools: true },
              },
            ]
          : [];
      const discoveredModels = [
        ...(ollamaModelsByProvider[provider.id] ?? []),
        ...getCatalogModelDefinitionsForProvider(liveCatalog, provider),
        ...getModelsDevDefinitionsForProvider(modelsDevCatalog, provider),
      ]
        .filter(
          (model) =>
            provider.family !== "openai" ||
            provider.authType !== "oauth" ||
            isCodexOAuthModel(model.id),
        )
        .filter(
          (model, index, models) =>
            models.findIndex((candidate) => candidate.id === model.id) ===
            index,
        );
      const models = [
        ...discoveredModels,
        ...builtInModels.filter(
          (model) =>
            !discoveredModels.some((discovered) => discovered.id === model.id),
        ),
        ...input.modelPresets
          .filter(
            (preset) =>
              preset.providerId === provider.id &&
              (provider.family !== "openai" ||
                provider.authType !== "oauth" ||
                isCodexOAuthModel(preset.modelId)) &&
              !discoveredModels.some((model) => model.id === preset.modelId) &&
              !builtInModels.some((model) => model.id === preset.modelId),
          )
          .map((preset) => ({
            id: preset.modelId,
            kind: "chat" as const,
            label: preset.label?.trim() || preset.modelId,
            options: preset.options ?? undefined,
          })),
      ];

      return [provider.id, models];
    }),
  );
  const availableModels = input.providers.flatMap((provider) => {
    const suggestions = suggestedModelsByProvider[provider.id] ?? [];

    return suggestions
      .map<ResolvedModel | null>((suggestion) => {
        const preset =
          input.modelPresets.find(
            (item) =>
              item.providerId === provider.id && item.modelId === suggestion.id,
          ) ?? null;

        return resolveConfiguredModel({
          active: activeProviderIds.includes(provider.id),
          definition: suggestion,
          isDefault: preset?.isDefault ?? false,
          modelId: suggestion.id,
          options: preset?.options ?? suggestion.options ?? null,
          preset,
          provider,
        });
      })
      .filter((model): model is ResolvedModel => model !== null);
  });

  const activeModels = availableModels.filter((model) => model.active);
  const requestedModel =
    input.settings.activeModelRef === null
      ? null
      : (activeModels.find(
          (model) => model.ref === input.settings.activeModelRef,
        ) ?? null);
  const currentModel =
    requestedModel ??
    activeModels.find((model) => model.isDefault) ??
    activeModels[0] ??
    null;

  return {
    activeProviderIds,
    providers: input.providers,
    modelPresets: input.modelPresets,
    suggestedModelsByProvider,
    providerModelDiscovery,
    availableModels,
    activeModels,
    currentModel,
    currentModelSupportsImageGeneration:
      currentModel?.supportsImageGeneration ?? false,
    currentModelSupportsImageInput: currentModel?.supportsImageInput ?? false,
    currentModelSupportsTools:
      (currentModel?.supportsTools ?? false) &&
      (hasEnabledWorkspaceTools(input.settings.builtInToolSettings) ||
        hasEnabledFolderTools(input.settings.builtInToolSettings)),
    databaseMode: input.settings.databaseMode,
    databaseUrl: input.settings.databaseUrl,
  } satisfies ResolvedConfig;
}

export function AppStateProvider({ children }: AppStateProviderProps) {
  const db = useSQLiteContext();
  const repositoriesRef = useRef(createRepositories(db));
  const workspaceServiceRef = useRef(
    createWorkspaceFileService(repositoriesRef.current.workspaceRepository),
  );
  const externalFolderServiceRef = useRef(createExternalFolderService());
  const runRegistryRef = useRef(createRunControllerRegistry());
  if (runRegistryRef.current.version !== 2) {
    runRegistryRef.current = createRunControllerRegistry();
  }
  const [snapshot, setSnapshot] = useState<AppStateSnapshot>(EMPTY_SNAPSHOT);
  const [ready, setReady] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingToolApprovals, setPendingToolApprovals] = useState<
    PendingToolApproval[]
  >([]);
  const [inAppNotification, setInAppNotification] = useState<{
    body: string;
    conversationId: string;
    id: string;
    title: string;
  } | null>(null);
  const snapshotRef = useRef(snapshot);
  const appStateRef = useRef(AppState.currentState);

  snapshotRef.current = snapshot;

  useEffect(() => {
    logMessageDebug("snapshot-updated", {
      currentConversationId: snapshot.currentConversation?.id ?? null,
      messages: buildMessageDebugSummary(snapshot.messages),
    });
  }, [snapshot.currentConversation?.id, snapshot.messages]);

  function resolvePendingToolApproval(
    approval: PendingToolApproval,
    decision: ToolApprovalDecision,
  ) {
    runRegistryRef.current.resolvePendingApproval(
      approval.runId,
      approval.id,
      decision,
    );
    setPendingToolApprovals((current) =>
      current.filter((item) => item.id !== approval.id),
    );
  }

  async function requestToolApproval(
    run: AgentRun,
    request: PendingToolApprovalRequest,
  ) {
    if (snapshotRef.current.settings.toolApprovalMode !== "ask") {
      return "approve" satisfies ToolApprovalDecision;
    }

    const conversation =
      snapshotRef.current.conversations.find(
        (item) => item.id === run.conversationId,
      ) ?? snapshotRef.current.currentConversation;
    const approval = createPendingToolApproval(
      run,
      conversation?.title ?? "Chat",
      request,
    );

    setPendingToolApprovals((current) => [...current, approval]);

    return await new Promise<ToolApprovalDecision>((resolve) => {
      runRegistryRef.current.registerPendingApproval(
        run.id,
        approval.id,
        resolve,
      );
    });
  }

  function dismissInAppNotification() {
    setInAppNotification(null);
  }

  async function notifyRunStateChange(input: {
    body: string;
    conversationId: string;
    title: string;
  }) {
    const currentConversationId =
      snapshotRef.current.currentConversation?.id ?? null;

    if (
      appStateRef.current === "active" &&
      currentConversationId !== input.conversationId
    ) {
      setInAppNotification({
        ...input,
        id: `${input.conversationId}:${Date.now()}`,
      });
      return;
    }

    await notifyRunFinishedAsync(input);
  }

  async function updateRunRecord(
    runId: string,
    input: Parameters<
      typeof repositoriesRef.current.agentRunRepository.update
    >[1],
  ) {
    await repositoriesRef.current.agentRunRepository.update(runId, input);

    const nextRun =
      await repositoriesRef.current.agentRunRepository.getById(runId);

    if (!nextRun) {
      return null;
    }

    setSnapshot((current) => ({
      ...current,
      agentRuns: upsertAgentRun(current.agentRuns, nextRun),
    }));

    return nextRun;
  }

  async function generateAndApplyConversationTitle(input: {
    conversation: Conversation;
    firstUserMessage: string;
    model: ResolvedModel;
    provider: ProviderConfig;
    runId: string;
  }) {
    const fallback = buildConversationTitle(input.firstUserMessage);
    let title = fallback;

    try {
      const result = await modelRuntime.generateTextStream({
        maxToolSteps: 1,
        messages: [
          {
            role: "user",
            content: input.firstUserMessage,
          },
        ],
        model: input.model,
        provider: input.provider,
        secretStore: secureSecretStore,
        sessionId: `${input.runId}:title`,
        system: [
          "You generate concise titles for chat conversations.",
          "Return only one plain-text title with 3 to 7 words.",
          "Describe the user's main intent. Do not use quotes, markdown, or ending punctuation.",
        ].join("\n"),
      });

      title = normalizeGeneratedConversationTitle(result.text, fallback);
    } catch {}

    const latest = await repositoriesRef.current.conversationRepository.getById(
      input.conversation.id,
    );

    if (!latest || latest.title !== "New chat") return;

    const updatedConversation = {
      ...latest,
      title,
      updatedAt: new Date().toISOString(),
    };

    await repositoriesRef.current.conversationRepository.updateMetadata(
      latest.id,
      {
        title,
        updatedAt: updatedConversation.updatedAt,
      },
    );

    setSnapshot((current) => ({
      ...current,
      conversations: upsertConversation(
        current.conversations,
        updatedConversation,
      ),
      currentConversation:
        current.currentConversation?.id === updatedConversation.id
          ? updatedConversation
          : current.currentConversation,
    }));
  }

  async function hydrate() {
    setHydrating(true);
    setError(null);

    try {
      const repositories = repositoriesRef.current;

      await repositories.configRepository.ensureDefaultProviders();

      let settings = await repositories.configRepository.getSettings();
      let conversations = await repositories.conversationRepository.list();

      if (conversations.length === 0) {
        const firstConversation =
          await repositories.conversationRepository.create({
            title: "New chat",
          });

        conversations = [firstConversation];
      }

      if (
        !settings.activeConversationId ||
        !conversations.some(
          (conversation) => conversation.id === settings.activeConversationId,
        )
      ) {
        settings = {
          ...settings,
          activeConversationId: conversations[0]?.id ?? null,
        };

        await repositories.configRepository.setSetting(
          "active_conversation_id",
          settings.activeConversationId,
        );
      }

      const providers =
        await repositories.configRepository.listProviderConfigs();
      let modelPresets = await repositories.configRepository.listModelPresets();
      let resolvedConfig = await resolveConfig({
        providers,
        modelPresets,
        settings,
      });

      if (resolvedConfig.currentModel?.ref !== settings.activeModelRef) {
        settings = {
          ...settings,
          activeModelRef: resolvedConfig.currentModel?.ref ?? null,
        };

        await repositories.configRepository.setSetting(
          "active_model_ref",
          settings.activeModelRef,
        );

        resolvedConfig = {
          ...resolvedConfig,
          currentModel: resolvedConfig.currentModel,
          databaseMode: settings.databaseMode,
          databaseUrl: settings.databaseUrl,
        };
      }

      const currentConversation =
        conversations.find(
          (conversation) => conversation.id === settings.activeConversationId,
        ) ?? null;
      const agentRuns = await repositories.agentRunRepository.list();
      const staleRuns = agentRuns.filter(
        (run) =>
          (run.status === "running" || run.status === "waiting_for_approval") &&
          !runRegistryRef.current.owns(run.id),
      );

      for (const run of staleRuns) {
        await repositories.agentRunRepository.update(run.id, {
          lastError: null,
          status: "resumable",
        });
      }

      const normalizedAgentRuns =
        staleRuns.length > 0
          ? await repositories.agentRunRepository.list()
          : agentRuns;
      const activeAssistantMessageIds = new Set(
        normalizedAgentRuns
          .filter((run) => isActiveAgentRunStatus(run.status))
          .map((run) => run.assistantMessageId),
      );
      const streamingMessages =
        await repositories.messageRepository.listStreaming();

      for (const message of streamingMessages) {
        if (activeAssistantMessageIds.has(message.id)) {
          continue;
        }

        await repositories.messageRepository.updateContent({
          id: message.id,
          content:
            message.content || "Generation interrupted. Send again to retry.",
          error: "Generation interrupted.",
          status: "failed",
        });
      }

      const messages = currentConversation
        ? await repositories.messageRepository.listByConversation(
            currentConversation.id,
          )
        : [];
      const memories = await repositories.memoryRepository.list();
      const mcpServers = await repositories.mcpServerRepository.list();
      const skills = await repositories.skillRepository.list();
      const workspaceFiles = await repositories.workspaceRepository.list();
      const nextSnapshot = {
        agentRuns: normalizedAgentRuns,
        conversations,
        currentConversation,
        currentSelectedFileIds: currentConversation?.selectedFileIds ?? [],
        currentSelectedSkillIds: currentConversation?.selectedSkillIds ?? [],
        memories,
        mcpServers,
        messages,
        skills,
        workspaceFiles,
        resolvedConfig,
        settings,
      } satisfies AppStateSnapshot;

      setSnapshot((current) => {
        const hasLocallyOwnedRuns = current.agentRuns.some((run) =>
          runRegistryRef.current.owns(run.id),
        );
        const reconciledSnapshot = hasLocallyOwnedRuns
          ? {
              ...nextSnapshot,
              agentRuns: current.agentRuns.reduce(
                (runs, run) =>
                  runRegistryRef.current.owns(run.id)
                    ? upsertAgentRun(runs, run)
                    : runs,
                nextSnapshot.agentRuns,
              ),
              messages:
                current.currentConversation?.id === currentConversation?.id
                  ? upsertMessages(nextSnapshot.messages, current.messages)
                  : nextSnapshot.messages,
            }
          : nextSnapshot;
        snapshotRef.current = reconciledSnapshot;
        return reconciledSnapshot;
      });
      setReady(true);
    } catch (hydrateError) {
      setError(
        hydrateError instanceof Error
          ? hydrateError.message
          : "Failed to hydrate app state.",
      );
    } finally {
      setHydrating(false);
    }
  }

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (!ready || hydrating) {
      return;
    }

    prepareRunNotificationsAsync().catch(() => {});
    resumePendingRuns().catch(() => {});
  }, [hydrating, ready]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      appStateRef.current = nextAppState;

      if (nextAppState === "active") {
        void (async () => {
          await hydrate();
          await resumePendingRuns();
        })().catch(() => {});
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  async function refresh() {
    await hydrate();
  }

  async function refreshWorkspaceFiles() {
    const workspaceFiles =
      await repositoriesRef.current.workspaceRepository.list();

    setSnapshot((current) => ({
      ...current,
      workspaceFiles,
    }));
  }

  async function clearWorkspaceFiles() {
    await workspaceServiceRef.current.clearAll();

    const conversations = await Promise.all(
      snapshotRef.current.conversations.map(async (conversation) => {
        if (conversation.selectedFileIds.length === 0) {
          return conversation;
        }

        await repositoriesRef.current.conversationRepository.updateMetadata(
          conversation.id,
          { selectedFileIds: [] },
        );

        return { ...conversation, selectedFileIds: [] };
      }),
    );

    setSnapshot((current) => ({
      ...current,
      conversations,
      currentConversation: current.currentConversation
        ? { ...current.currentConversation, selectedFileIds: [] }
        : null,
      currentSelectedFileIds: [],
      workspaceFiles: [],
    }));
  }

  async function deleteWorkspaceFile(fileId: string) {
    const file = await repositoriesRef.current.workspaceRepository.getById(
      fileId,
    );

    if (!file || file.sourceKind !== "imported") {
      return;
    }

    await workspaceServiceRef.current.deleteFile(file);

    const conversations = await Promise.all(
      snapshotRef.current.conversations.map(async (conversation) => {
        if (!conversation.selectedFileIds.includes(fileId)) {
          return conversation;
        }

        const selectedFileIds = conversation.selectedFileIds.filter(
          (id) => id !== fileId,
        );
        await repositoriesRef.current.conversationRepository.updateMetadata(
          conversation.id,
          { selectedFileIds },
        );

        return { ...conversation, selectedFileIds };
      }),
    );

    setSnapshot((current) => ({
      ...current,
      conversations,
      currentConversation: current.currentConversation
        ? {
            ...current.currentConversation,
            selectedFileIds: current.currentConversation.selectedFileIds.filter(
              (id) => id !== fileId,
            ),
          }
        : null,
      currentSelectedFileIds: current.currentSelectedFileIds.filter(
        (id) => id !== fileId,
      ),
      workspaceFiles: current.workspaceFiles.filter(
        (workspaceFile) => workspaceFile.id !== fileId,
      ),
    }));
  }

  async function updateProvider(
    providerId: string,
    input: {
      baseUrl?: string | null;
      enabled?: boolean;
      label?: string;
      oauthAccountEmail?: string | null;
    },
  ) {
    await repositoriesRef.current.configRepository.updateProvider(
      providerId,
      input,
    );
    await hydrate();
  }

  async function createProvider(input: {
    authType: ProviderConfig["authType"];
    baseUrl?: string | null;
    family: ProviderConfig["family"];
    id: string;
    label: string;
    oauthAccountEmail?: string | null;
  }) {
    const provider =
      await repositoriesRef.current.configRepository.createProvider(input);
    await hydrate();
    return provider;
  }

  async function saveProviderApiKey(providerId: string, apiKey: string) {
    await secureSecretStore.setProviderApiKey(providerId, apiKey.trim());
    await hydrate();
  }

  async function clearProviderApiKey(providerId: string) {
    await secureSecretStore.deleteProviderApiKey(providerId);
    await hydrate();
  }

  function getHeaderNames(headers?: Record<string, string>) {
    return Object.entries(headers ?? {})
      .filter(([name, value]) => name.trim() && value.trim())
      .map(([name]) => name.trim());
  }

  async function createMcpServer(input: {
    authMode: McpServerAuthMode;
    enabled?: boolean;
    headerValues?: Record<string, string>;
    label: string;
    oauthAllowedAuthOrigin?: string | null;
    oauthAuthorizationUrl?: string | null;
    oauthClientId?: string | null;
    oauthScopes?: string | null;
    oauthTokenUrl?: string | null;
    transport: McpServerTransport;
    url: string;
  }) {
    const server = await repositoriesRef.current.mcpServerRepository.create({
      authMode: input.authMode,
      enabled: input.enabled,
      headerNames: getHeaderNames(input.headerValues),
      label: input.label,
      oauthAllowedAuthOrigin: input.oauthAllowedAuthOrigin,
      oauthAuthorizationUrl: input.oauthAuthorizationUrl,
      oauthClientId: input.oauthClientId,
      oauthScopes: input.oauthScopes,
      oauthTokenUrl: input.oauthTokenUrl,
      transport: input.transport,
      url: input.url,
    });

    if (input.headerValues) {
      await secureSecretStore.setMcpHeaderValues(server.id, input.headerValues);
    }

    await hydrate();
    return server;
  }

  async function updateMcpServer(
    serverId: string,
    input: {
      authMode?: McpServerAuthMode;
      enabled?: boolean;
      headerValues?: Record<string, string>;
      label?: string;
      oauthAllowedAuthOrigin?: string | null;
      oauthAuthorizationUrl?: string | null;
      oauthClientId?: string | null;
      oauthScopes?: string | null;
      oauthTokenUrl?: string | null;
      transport?: McpServerTransport;
      url?: string;
    },
  ) {
    await repositoriesRef.current.mcpServerRepository.update(serverId, {
      authMode: input.authMode,
      enabled: input.enabled,
      headerNames: input.headerValues
        ? getHeaderNames(input.headerValues)
        : undefined,
      label: input.label,
      oauthAllowedAuthOrigin: input.oauthAllowedAuthOrigin,
      oauthAuthorizationUrl: input.oauthAuthorizationUrl,
      oauthClientId: input.oauthClientId,
      oauthScopes: input.oauthScopes,
      oauthTokenUrl: input.oauthTokenUrl,
      transport: input.transport,
      url: input.url,
    });

    if (input.headerValues) {
      await secureSecretStore.setMcpHeaderValues(serverId, input.headerValues);
    }

    await hydrate();
  }

  async function deleteMcpServer(serverId: string) {
    await repositoriesRef.current.mcpServerRepository.delete(serverId);
    await Promise.all([
      secureSecretStore.deleteMcpHeaderValues(serverId),
      secureSecretStore.deleteMcpOAuthTokens(serverId),
    ]);
    await hydrate();
  }

  async function saveMcpServerHeaderValues(
    serverId: string,
    headers: Record<string, string>,
  ) {
    await secureSecretStore.setMcpHeaderValues(serverId, headers);
    await repositoriesRef.current.mcpServerRepository.update(serverId, {
      headerNames: getHeaderNames(headers),
    });
    await hydrate();
  }

  async function clearMcpServerCredentials(serverId: string) {
    await Promise.all([
      secureSecretStore.deleteMcpHeaderValues(serverId),
      secureSecretStore.deleteMcpOAuthTokens(serverId),
    ]);
    await repositoriesRef.current.mcpServerRepository.update(serverId, {
      headerNames: [],
    });
    await hydrate();
  }

  async function connectMcpServerOAuth(serverId: string) {
    const server =
      await repositoriesRef.current.mcpServerRepository.getById(serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    await connectMcpOAuth(server);
    await hydrate();
  }

  async function testMcpServer(serverId: string) {
    const server =
      await repositoriesRef.current.mcpServerRepository.getById(serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    try {
      const result = await testMcpServerConnection(server);

      await repositoriesRef.current.mcpServerRepository.updateConnectionState(
        serverId,
        {
          lastError: null,
          lastStatus: "connected",
          serverInfo: result.serverInfo,
          serverInstructions: result.instructions,
          toolCount: result.toolCount,
        },
      );
    } catch (testError) {
      await repositoriesRef.current.mcpServerRepository.updateConnectionState(
        serverId,
        {
          lastError:
            testError instanceof Error
              ? testError.message
              : "Failed to connect MCP server.",
          lastStatus: "failed",
          serverInfo: null,
          serverInstructions: null,
          toolCount: null,
        },
      );

      throw testError;
    } finally {
      await hydrate();
    }
  }

  async function createModelPreset(input: {
    label?: string | null;
    makeDefault?: boolean;
    modelId: string;
    options?: Record<string, unknown> | null;
    providerId: string;
    select?: boolean;
  }) {
    const preset =
      await repositoriesRef.current.configRepository.createModelPreset({
        providerId: input.providerId,
        modelId: input.modelId,
        label: input.label,
        options: input.options,
        makeDefault: input.makeDefault,
      });

    if (input.select) {
      await repositoriesRef.current.configRepository.setSetting(
        "active_model_ref",
        createModelRef(preset.providerId, preset.modelId),
      );
    }

    await hydrate();
  }

  async function deleteModelPreset(modelPresetId: string) {
    const preset = snapshotRef.current.resolvedConfig.modelPresets.find(
      (item) => item.id === modelPresetId,
    );

    if (preset) {
      const presetRef = createModelRef(preset.providerId, preset.modelId);

      if (snapshotRef.current.settings.activeModelRef === presetRef) {
        await repositoriesRef.current.configRepository.setSetting(
          "active_model_ref",
          null,
        );
      }
    }

    await repositoriesRef.current.configRepository.deleteModelPreset(
      modelPresetId,
    );
    await hydrate();
  }

  async function setDefaultModelPreset(modelPresetId: string) {
    await repositoriesRef.current.configRepository.setDefaultModelPreset(
      modelPresetId,
    );
    await hydrate();
  }

  async function createSkill(input: {
    autoMatch?: boolean;
    description?: string | null;
    enabled?: boolean;
    instructions: string;
    matchKeywords?: string[];
    recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
    recommendedMcpServerIds?: string[];
    title: string;
  }) {
    const skill = await repositoriesRef.current.skillRepository.create(input);
    await hydrate();
    return skill;
  }

  async function updateSkill(
    skillId: string,
    input: {
      autoMatch?: boolean;
      description?: string | null;
      enabled?: boolean;
      instructions?: string;
      matchKeywords?: string[];
      recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
      recommendedMcpServerIds?: string[];
      title?: string;
    },
  ) {
    await repositoriesRef.current.skillRepository.update(skillId, input);
    await hydrate();
  }

  async function deleteSkill(skillId: string) {
    await repositoriesRef.current.skillRepository.delete(skillId);
    await hydrate();
  }

  async function createMemory(input: { content: string; enabled?: boolean }) {
    const memory = await repositoriesRef.current.memoryRepository.create({
      content: input.content,
      enabled: input.enabled,
      sourceConversationId: snapshotRef.current.currentConversation?.id ?? null,
      sourceMessageId: null,
    });
    await hydrate();
    return memory;
  }

  async function updateMemory(
    memoryId: string,
    input: {
      content?: string;
      enabled?: boolean;
    },
  ) {
    await repositoriesRef.current.memoryRepository.update(memoryId, input);
    await hydrate();
  }

  async function deleteMemory(memoryId: string) {
    await repositoriesRef.current.memoryRepository.archive(memoryId);
    await hydrate();
  }

  async function updateDatabaseSettings(input: {
    databaseMode?: AppSettings["databaseMode"];
    databaseUrl?: string | null;
  }) {
    await repositoriesRef.current.configRepository.setDatabaseSettings(input);
    await hydrate();
  }

  async function updateBuiltInToolSettings(
    input: Partial<BuiltInToolSettings>,
  ) {
    await repositoriesRef.current.configRepository.setBuiltInToolSettings(
      input,
    );
    await hydrate();
  }

  async function updateToolApprovalMode(mode: AppSettings["toolApprovalMode"]) {
    await repositoriesRef.current.configRepository.setToolApprovalMode(mode);
    await hydrate();
  }

  async function updateMaxToolSteps(maxToolSteps: number) {
    await repositoriesRef.current.configRepository.setMaxToolSteps(
      maxToolSteps,
    );
    await hydrate();
  }

  async function updateThemeMode(mode: AppSettings["themeMode"]) {
    await repositoriesRef.current.configRepository.setThemeMode(mode);
    await hydrate();
  }

  async function updateMemoryEnabled(enabled: boolean) {
    await repositoriesRef.current.configRepository.setMemoryEnabled(enabled);
    await hydrate();
  }

  function setOpenAIOAuthEmailInSnapshot(email: string | null) {
    setSnapshot((current) => {
      const providers = current.resolvedConfig.providers.map((provider) =>
        provider.id === "openai"
          ? { ...provider, oauthAccountEmail: email }
          : provider,
      );

      const nextSnapshot = {
        ...current,
        resolvedConfig: {
          ...current.resolvedConfig,
          providers,
        },
      };

      snapshotRef.current = nextSnapshot;
      return nextSnapshot;
    });
  }

  async function persistOpenAIOAuthEmail(email: string | null) {
    try {
      await repositoriesRef.current.configRepository.setProviderOauthEmail(
        "openai",
        email,
      );
    } catch {}
  }

  async function connectOpenAIOAuth() {
    await handleLogin();

    const startedAt = Date.now();

    while (Date.now() - startedAt < 20000) {
      const [accessToken, refreshToken] = await Promise.all([
        getOpenAiAccessToken(),
        getOpenAiRefreshToken(),
      ]);

      if (accessToken || refreshToken) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const tokenInfo = await getOpenAiTokenInfo();
    setOpenAIOAuthEmailInSnapshot(tokenInfo.email);
    await persistOpenAIOAuthEmail(tokenInfo.email);
    await hydrate().catch(() => {});
  }

  async function disconnectOpenAIOAuth() {
    await clearOpenAiTokens();
    setOpenAIOAuthEmailInSnapshot(null);
    await persistOpenAIOAuthEmail(null);
    await hydrate().catch(() => {});
  }

  async function createConversation() {
    const repositories = repositoriesRef.current;
    const currentModel = snapshotRef.current.resolvedConfig.currentModel;
    const conversation = await repositories.conversationRepository.create({
      title: "New chat",
      providerId: currentModel?.providerId ?? null,
      modelId: currentModel?.modelId ?? null,
    });

    await repositories.configRepository.setSetting(
      "active_conversation_id",
      conversation.id,
    );

    setSnapshot((current) => ({
      ...current,
      conversations: upsertConversation(current.conversations, conversation),
      currentConversation: conversation,
      currentSelectedFileIds: [],
      currentSelectedSkillIds: [],
      messages: [],
      settings: {
        ...current.settings,
        activeConversationId: conversation.id,
      },
    }));
  }

  async function deleteConversation(conversationId: string) {
    await repositoriesRef.current.conversationRepository.deleteById(
      conversationId,
    );
    await hydrate();
  }

  async function importFiles(assets: DocumentPickerAsset[]) {
    const importedFiles: WorkspaceFile[] = [];

    for (const asset of assets) {
      importedFiles.push(
        await workspaceServiceRef.current.importDocument(asset),
      );
    }

    setSnapshot((current) => ({
      ...current,
      workspaceFiles: upsertWorkspaceFiles(
        current.workspaceFiles,
        importedFiles,
      ),
    }));

    await refreshWorkspaceFiles();

    return importedFiles;
  }

  async function createWorkspaceFile(input: { content: string; name: string }) {
    const file = await workspaceServiceRef.current.createTextFile(input);

    setSnapshot((current) => ({
      ...current,
      workspaceFiles: upsertWorkspaceFiles(current.workspaceFiles, [file]),
    }));

    await refreshWorkspaceFiles();
    return file;
  }

  async function pickConversationFolder() {
    const currentConversation = snapshotRef.current.currentConversation;

    if (!currentConversation) {
      throw new Error("No active conversation available.");
    }

    if (Platform.OS !== "android") {
      throw new Error(
        "Picked-folder agent access is Android-only right now. Use workspace files on this platform.",
      );
    }

    const session = await externalFolderServiceRef.current.pickDirectory(
      currentConversation.externalFolderSession?.uri,
    );

    await repositoriesRef.current.conversationRepository.updateMetadata(
      currentConversation.id,
      {
        externalFolderSession: session,
      },
    );

    setSnapshot((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === currentConversation.id
          ? { ...conversation, externalFolderSession: session }
          : conversation,
      ),
      currentConversation:
        current.currentConversation?.id === currentConversation.id
          ? { ...current.currentConversation, externalFolderSession: session }
          : current.currentConversation,
    }));

    return session;
  }

  async function clearConversationFolder() {
    const currentConversation = snapshotRef.current.currentConversation;

    if (!currentConversation) {
      return;
    }

    await repositoriesRef.current.conversationRepository.updateMetadata(
      currentConversation.id,
      {
        externalFolderSession: null,
      },
    );

    setSnapshot((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === currentConversation.id
          ? { ...conversation, externalFolderSession: null }
          : conversation,
      ),
      currentConversation:
        current.currentConversation?.id === currentConversation.id
          ? { ...current.currentConversation, externalFolderSession: null }
          : current.currentConversation,
    }));
  }

  async function selectConversation(conversationId: string) {
    const repositories = repositoriesRef.current;
    const nextConversation =
      await repositories.conversationRepository.getById(conversationId);

    if (!nextConversation) {
      return;
    }

    const messages =
      await repositories.messageRepository.listByConversation(conversationId);

    logMessageDebug("select-conversation", {
      conversationId,
      loadedMessages: buildMessageDebugSummary(messages),
      nextConversationId: nextConversation.id,
    });

    await repositories.configRepository.setSetting(
      "active_conversation_id",
      conversationId,
    );

    setSnapshot((current) => ({
      ...current,
      currentConversation: nextConversation,
      currentSelectedFileIds: nextConversation.selectedFileIds,
      currentSelectedSkillIds: nextConversation.selectedSkillIds,
      messages,
      settings: {
        ...current.settings,
        activeConversationId: conversationId,
      },
    }));
  }

  async function setCurrentSelectedFileIds(selectedFileIds: string[]) {
    const repositories = repositoriesRef.current;
    const currentConversation = snapshotRef.current.currentConversation;

    if (!currentConversation) {
      return;
    }

    const nextSelectedFileIds = Array.from(
      new Set(selectedFileIds.filter(Boolean)),
    );
    const updatedConversation: Conversation = {
      ...currentConversation,
      selectedFileIds: nextSelectedFileIds,
      updatedAt: currentConversation.updatedAt,
    };

    await repositories.conversationRepository.updateMetadata(
      currentConversation.id,
      {
        selectedFileIds: nextSelectedFileIds,
      },
    );

    setSnapshot((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === currentConversation.id
          ? {
              ...conversation,
              selectedFileIds: nextSelectedFileIds,
            }
          : conversation,
      ),
      currentConversation: updatedConversation,
      currentSelectedFileIds: nextSelectedFileIds,
    }));
  }

  async function setCurrentSelectedSkillIds(selectedSkillIds: string[]) {
    const repositories = repositoriesRef.current;
    const currentConversation = snapshotRef.current.currentConversation;

    if (!currentConversation) {
      return;
    }

    const existingSkillIds = new Set(
      snapshotRef.current.skills.map((skill) => skill.id),
    );
    const nextSelectedSkillIds = Array.from(
      new Set(
        selectedSkillIds.filter((skillId) => existingSkillIds.has(skillId)),
      ),
    );
    const updatedConversation: Conversation = {
      ...currentConversation,
      selectedSkillIds: nextSelectedSkillIds,
      updatedAt: currentConversation.updatedAt,
    };

    await repositories.conversationRepository.updateMetadata(
      currentConversation.id,
      {
        selectedSkillIds: nextSelectedSkillIds,
      },
    );

    setSnapshot((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === currentConversation.id
          ? {
              ...conversation,
              selectedSkillIds: nextSelectedSkillIds,
            }
          : conversation,
      ),
      currentConversation: updatedConversation,
      currentSelectedSkillIds: nextSelectedSkillIds,
    }));
  }

  async function selectModel(modelRef: ModelRef) {
    await repositoriesRef.current.configRepository.setSetting(
      "active_model_ref",
      modelRef,
    );
    await hydrate();
  }

  async function executeAgentRun(runId: string) {
    if (!runRegistryRef.current.claim(runId)) {
      return;
    }

    try {
      await executeClaimedAgentRun(runId);
    } catch (error) {
      runRegistryRef.current.clear(runId);
      throw error;
    }
  }

  async function executeClaimedAgentRun(runId: string) {
    const repositories = repositoriesRef.current;
    const run =
      snapshotRef.current.agentRuns.find((item) => item.id === runId) ??
      (await repositories.agentRunRepository.getById(runId));

    if (!run || !shouldAutoResumeRun(run.status)) {
      runRegistryRef.current.clear(runId);
      return;
    }

    const conversation =
      snapshotRef.current.conversations.find(
        (item) => item.id === run.conversationId,
      ) ??
      (await repositories.conversationRepository.getById(run.conversationId));

    if (!conversation) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: "Chat not found.",
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    const provider = snapshotRef.current.resolvedConfig.providers.find(
      (item) => item.id === run.providerId,
    );

    if (!provider) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: `Provider ${run.providerId} is unavailable.`,
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    const resolvedModel =
      snapshotRef.current.resolvedConfig.availableModels.find(
        (item) =>
          item.providerId === run.providerId && item.modelId === run.modelId,
      ) ??
      resolveConfiguredModel({
        active: false,
        isDefault: false,
        modelId: run.modelId,
        options: null,
        preset: null,
        provider,
      });

    if (!resolvedModel) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: `Model ${run.modelId} is unavailable for ${provider.label}.`,
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    const abortController = new AbortController();
    let requestTimedOut = false;
    let inactivityTimeout: ReturnType<typeof setTimeout> | null = null;

    runRegistryRef.current.registerAbortController(run.id, abortController);

    const scheduleInactivityTimeout = () => {
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }

      inactivityTimeout = setTimeout(() => {
        const latestRun = snapshotRef.current.agentRuns.find(
          (item) => item.id === run.id,
        );

        if (latestRun?.status === "waiting_for_approval") {
          scheduleInactivityTimeout();
          return;
        }

        requestTimedOut = true;
        abortController.abort();
      }, REQUEST_INACTIVITY_TIMEOUT_MS);
    };

    const markActivity = () => {
      scheduleInactivityTimeout();
    };

    const resumedRun = await updateRunRecord(run.id, {
      completedAt: null,
      lastError: null,
      resumeCount:
        run.status === "resumable" ? run.resumeCount + 1 : run.resumeCount,
      status: "running",
    });

    const persistedMessages =
      await repositories.messageRepository.listByConversation(conversation.id);
    const assistantMessage = persistedMessages.find(
      (message) => message.id === run.assistantMessageId,
    );
    const userMessage = persistedMessages.find(
      (message) => message.id === run.userMessageId,
    );

    if (!assistantMessage) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: "Assistant message not found.",
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    const baseAssistantMetadata: MessageMetadata | null = {
      ...(assistantMessage.metadata ?? {}),
      runId: run.id,
    };
    const startingAssistantText =
      run.status === "resumable" ? "" : assistantMessage.content;

    await repositories.messageRepository.updateContent({
      id: assistantMessage.id,
      content: startingAssistantText,
      error: null,
      metadata: baseAssistantMetadata,
      status: "streaming",
    });

    setSnapshot((current) => ({
      ...current,
      messages:
        current.currentConversation?.id === conversation.id
          ? upsertMessages(current.messages, [
              {
                ...assistantMessage,
                content: startingAssistantText,
                error: null,
                metadata: baseAssistantMetadata,
                status: "streaming",
              },
            ])
          : current.messages,
    }));

    const referencedWorkspaceFileIds = Array.from(
      new Set(
        persistedMessages.flatMap(
          (message) => message.metadata?.selectedFileIds ?? [],
        ),
      ),
    );
    const selectedWorkspaceFiles =
      referencedWorkspaceFileIds.length > 0
        ? await repositories.workspaceRepository.getByIds(
            referencedWorkspaceFileIds,
          )
        : [];
    const workspaceFilesById = new Map(
      selectedWorkspaceFiles.map((file) => [file.id, file]),
    );
    const currentRunWorkspaceFiles = run.selectedFileIds
      .map((fileId) => workspaceFilesById.get(fileId))
      .filter((file): file is WorkspaceFile => file !== undefined);
    const { binaryFiles, imageFiles } = partitionSelectedFiles(
      currentRunWorkspaceFiles,
    );

    if (imageFiles.length > 0 && !resolvedModel.supportsImageInput) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError:
          "The current model does not support image input. Switch to a vision-capable model to send images.",
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    if (binaryFiles.length > 0 && !resolvedModel.supportsTools) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError:
          "Binary file attachments require a tool-capable model for this chat.",
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    const runtimeMessageResult = await convertStoredMessagesToModelMessages({
      messages: persistedMessages.filter(
        (message) => message.id !== assistantMessage.id,
      ),
      supportsImageInput: resolvedModel.supportsImageInput,
      workspaceFilesById,
    });

    if (runtimeMessageResult.unsupportedImageAttachments.length > 0) {
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError:
          "This conversation includes image attachments, but the current model cannot read images.",
        status: "failed",
      });
      runRegistryRef.current.clear(runId);
      return;
    }

    const runtimeMessages = runtimeMessageResult.messages;
    const toolExecutions = [
      ...(assistantMessage.metadata?.toolExecutions ?? []),
    ] as ToolExecutionRecord[];
    const memoryEvents = [
      ...(assistantMessage.metadata?.memoryEvents ?? []),
    ] as MemoryEvent[];
    const promptArtifacts = [
      ...(assistantMessage.metadata?.promptArtifacts ?? []),
    ] as PromptArtifact[];
    const reasoning = [
      ...(assistantMessage.metadata?.reasoning ?? []),
    ] as ReasoningBlock[];
    const executionTimeline = [
      ...(assistantMessage.metadata?.executionTimeline ?? []),
    ] as ExecutionTimelineEvent[];
    const appliedSkillIds =
      assistantMessage.metadata?.appliedSkillIds ??
      userMessage?.metadata?.appliedSkillIds ??
      [];
    const appliedSkillIdSet = new Set(appliedSkillIds);
    const appliedSkills = snapshotRef.current.skills.filter((skill) =>
      appliedSkillIdSet.has(skill.id),
    );
    const useInlineFileContext =
      run.fileContextSource === "workspace" &&
      currentRunWorkspaceFiles.length > 0;
    const externalFolderSession =
      run.fileContextSource === "external-folder"
        ? run.externalFolderSession
        : null;
    const selectedWorkspaceToolFileIds = currentRunWorkspaceFiles.map(
      (file) => file.id,
    );

    const pushTimelineEvent = (event: ExecutionTimelineEvent) => {
      executionTimeline.push(event);
    };

    const buildLiveAssistantMetadata = () =>
      buildAssistantMetadata({
        appliedSkillIds,
        executionTimeline,
        memoryEvents,
        promptArtifacts,
        reasoning,
        runId: run.id,
        toolExecutions,
      });

    const setRunWaitingForApproval = async () => {
      await updateRunRecord(run.id, {
        lastError: null,
        status: "waiting_for_approval",
      });
    };

    const requestRunApproval = async (request: PendingToolApprovalRequest) => {
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail: request.inputSummary,
          kind: "tool",
          status: "pending",
          title: `Approval requested for ${request.toolName}`,
        }),
      );
      refreshAssistantState?.();
      await setRunWaitingForApproval();

      const decision = await requestToolApproval(run, request);
      markActivity();

      if (decision !== "abort") {
        await updateRunRecord(run.id, {
          lastError: null,
          status: "running",
        });
      }

      return decision;
    };
    let refreshAssistantState: null | (() => void) = null;
    const pendingArtifactWrites: Promise<void>[] = [];
    let assistantText = startingAssistantText;
    let persistTimeout: ReturnType<typeof setTimeout> | null = null;

    const syncAssistantSnapshot = (
      status: StoredMessage["status"],
      errorMessage: string | null = null,
    ) => {
      const metadata = buildLiveAssistantMetadata();

      setSnapshot((current) => {
        logMessageDebug("assistant-sync", {
          conversationId: conversation.id,
          currentConversationId: current.currentConversation?.id ?? null,
          errorMessage,
          shouldPatchMessages:
            current.currentConversation?.id === conversation.id,
          status,
          currentMessages: buildMessageDebugSummary(current.messages),
        });

        return {
          ...current,
          messages:
            current.currentConversation?.id === conversation.id
              ? upsertMessages(current.messages, [
                  {
                    ...assistantMessage,
                    content: assistantText,
                    error: errorMessage,
                    metadata,
                    status,
                  },
                ])
              : current.messages,
        };
      });
    };

    const schedulePersist = (status: StoredMessage["status"]) => {
      if (persistTimeout) {
        clearTimeout(persistTimeout);
      }

      persistTimeout = setTimeout(() => {
        repositories.messageRepository
          .updateContent({
            id: assistantMessage.id,
            content: assistantText,
            error: null,
            metadata: buildLiveAssistantMetadata(),
            status,
          })
          .catch(() => {});
      }, 250);
    };

    const flushPersist = async (
      status: StoredMessage["status"],
      errorMessage: string | null,
      metadata: MessageMetadata | null,
    ) => {
      if (persistTimeout) {
        clearTimeout(persistTimeout);
        persistTimeout = null;
      }

      await repositories.messageRepository.updateContent({
        id: assistantMessage.id,
        content: assistantText,
        error: errorMessage,
        metadata,
        status,
      });
    };

    refreshAssistantState = () => {
      schedulePersist("streaming");
      syncAssistantSnapshot("streaming");
    };

    refreshAssistantState();
    markActivity();

    let mcpRuntime: Awaited<ReturnType<typeof createMcpRuntimeTools>> | null =
      null;

    const recordPromptArtifact = (artifact: PromptArtifact) => {
      promptArtifacts.push(artifact);
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail: describePromptArtifactLocation(artifact),
          kind: "prompt",
          status: "completed",
          title:
            artifact.category === "model"
              ? "Saved model prompt"
              : "Saved tool prompt",
          createdAt: artifact.createdAt,
        }),
      );
      refreshAssistantState?.();
    };

    const persistToolArtifact = async (record: ToolExecutionRecord) => {
      try {
        const artifactInput = buildToolExecutionArtifact({
          record,
          runId: run.id,
        });
        const file = await workspaceServiceRef.current.createManagedTextFile({
          content: artifactInput.content,
          folderSegments: ["tools"],
          name: artifactInput.fileName,
        });

        recordPromptArtifact(
          createPromptArtifactRecord({
            category: "tool",
            createdAt: record.createdAt,
            displayName: file.displayName,
            fileId: file.id,
            relativePath: file.relativePath,
          }),
        );
      } catch (artifactError) {
        pushTimelineEvent(
          createExecutionTimelineEvent({
            detail:
              artifactError instanceof Error
                ? artifactError.message
                : String(artifactError),
            kind: "prompt",
            status: "failed",
            title: `Failed to save ${record.toolName} prompt`,
          }),
        );
        refreshAssistantState?.();
      }
    };

    const handleToolExecutionRecord = (record: ToolExecutionRecord) => {
      toolExecutions.push(record);
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail:
            record.status === "failed"
              ? record.error
              : (record.outputSummary ?? record.inputSummary),
          kind: "tool",
          status: record.status,
          title: `${record.toolName} ${record.status}`,
          createdAt: record.createdAt,
        }),
      );
      markActivity();
      refreshAssistantState?.();
      const artifactWrite = persistToolArtifact(record);
      pendingArtifactWrites.push(artifactWrite);
      void artifactWrite;
    };

    try {
      const builtInRuntimeTools: ToolSet | undefined =
        resolvedModel.supportsTools &&
        run.fileContextSource === "external-folder"
          ? (() => {
              const folderTools = createExternalFolderTools({
                session: externalFolderSession as ExternalFolderSession,
                onRecord: handleToolExecutionRecord,
              }).tools;

              const enabledTools = filterToolsBySettings(folderTools, [
                [
                  "createDirectory",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderCreateDirectory,
                ],
                [
                  "createFile",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderCreateFile,
                ],
                [
                  "deleteEntry",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderDeleteEntry,
                ],
                [
                  "listDirectory",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderListDirectory,
                ],
                [
                  "moveEntry",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderMoveEntry,
                ],
                [
                  "readFile",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderReadFile,
                ],
                [
                  "renameEntry",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderRenameEntry,
                ],
                [
                  "writeFile",
                  snapshotRef.current.settings.builtInToolSettings
                    .folderWriteFile,
                ],
              ]);

              return Object.keys(enabledTools).length > 0
                ? (enabledTools as ToolSet)
                : undefined;
            })()
          : resolvedModel.supportsTools
            ? (() => {
                const workspaceTools = createWorkspaceTools({
                  repository: repositories.workspaceRepository,
                  onRecord: handleToolExecutionRecord,
                }).tools;

                const enabledTools = filterToolsBySettings(workspaceTools, [
                  [
                    "createFile",
                    snapshotRef.current.settings.builtInToolSettings
                      .workspaceCreateFile,
                  ],
                  [
                    "listFiles",
                    snapshotRef.current.settings.builtInToolSettings
                      .workspaceListFiles,
                  ],
                  [
                    "readFile",
                    snapshotRef.current.settings.builtInToolSettings
                      .workspaceReadFile,
                  ],
                  [
                    "writeFile",
                    snapshotRef.current.settings.builtInToolSettings
                      .workspaceWriteFile,
                  ],
                ]);

                return Object.keys(enabledTools).length > 0
                  ? (enabledTools as ToolSet)
                  : undefined;
              })()
            : undefined;
      mcpRuntime =
        resolvedModel.supportsTools && snapshotRef.current.mcpServers.length > 0
          ? await createMcpRuntimeTools({
              servers: snapshotRef.current.mcpServers,
              onRecord: handleToolExecutionRecord,
            })
          : null;
      const memoryRuntime =
        resolvedModel.supportsTools &&
        snapshotRef.current.settings.memoryEnabled
          ? createMemoryTools({
              conversationId: conversation.id,
              memoryRepository: repositories.memoryRepository,
              sourceMessageId: assistantMessage.id,
              onEvent: (event) => {
                memoryEvents.push(event);
                markActivity();
              },
            })
          : null;

      for (const serverResult of mcpRuntime?.serverResults ?? []) {
        repositories.mcpServerRepository
          .updateConnectionState(serverResult.server.id, {
            lastError: serverResult.error,
            lastStatus: serverResult.error ? "failed" : "connected",
            serverInfo: serverResult.serverInfo,
            serverInstructions: serverResult.instructions,
            toolCount: serverResult.toolCount,
          })
          .catch(() => {});
      }

      const unapprovedRuntimeTools =
        builtInRuntimeTools || mcpRuntime?.tools
          ? ({
              ...(builtInRuntimeTools ?? {}),
              ...(mcpRuntime?.tools ?? {}),
            } satisfies ToolSet)
          : undefined;
      const autoApprovedToolNames = new Set(
        run.fileContextSource === "external-folder"
          ? []
          : Object.keys(builtInRuntimeTools ?? {}),
      );
      const approvedRuntimeTools = unapprovedRuntimeTools
        ? wrapToolsWithApproval(unapprovedRuntimeTools, {
            getRequestSummary: (toolName, toolInput) => {
              const mcpDisplayName = mcpRuntime?.getToolDisplayName(toolName);

              if (mcpDisplayName) {
                return `${mcpDisplayName}: ${summarizeToolInput(toolInput)}`;
              }

              if (run.fileContextSource === "external-folder") {
                return buildExternalToolApprovalSummary(
                  externalFolderSession as ExternalFolderSession,
                  toolName,
                  toolInput,
                );
              }

              return summarizeToolInput(toolInput);
            },
            mode: snapshotRef.current.settings.toolApprovalMode,
            onRecord: handleToolExecutionRecord,
            shouldRequireApproval: (toolName) =>
              !autoApprovedToolNames.has(toolName),
            requestApproval: (request) =>
              requestRunApproval(request as PendingToolApprovalRequest),
          })
        : undefined;
      const runtimeTools =
        approvedRuntimeTools || memoryRuntime?.tools
          ? ({
              ...(approvedRuntimeTools ?? {}),
              ...(memoryRuntime?.tools ?? {}),
            } satisfies ToolSet)
          : undefined;
      const builtInRuntimeSystem =
        run.fileContextSource === "external-folder" && builtInRuntimeTools
          ? buildExternalFolderSystemPrompt(
              externalFolderSession as ExternalFolderSession,
            )
          : undefined;
      const selectedFilesContext = useInlineFileContext
        ? await buildSelectedFilesInlineContext({
            repository: repositories.workspaceRepository,
            selectedFileIds: selectedWorkspaceToolFileIds,
          })
        : undefined;

      if (selectedFilesContext) {
        appendContextToLatestUserMessage(runtimeMessages, selectedFilesContext);
      }
      const skillsRuntimeSystem = buildSkillsSystemPrompt({
        builtInToolSettings: snapshotRef.current.settings.builtInToolSettings,
        mcpServers: snapshotRef.current.mcpServers,
        skills: appliedSkills,
      });
      const memoryRuntimeSystem = snapshotRef.current.settings.memoryEnabled
        ? buildMemorySystemPrompt(snapshotRef.current.memories, {
            canWrite: resolvedModel.supportsTools,
          })
        : undefined;
      const toolLoopRuntimeSystem = runtimeTools
        ? [
            "Complete the user's requested task before ending your response.",
            "Before the first tool call, briefly tell the user what you are about to do.",
            "An inspection or listing tool is only an intermediate step when the user requested a change.",
            "After every tool result, evaluate what remains and continue calling the available tools until the task is complete or a concrete blocker prevents progress.",
            "Between tool calls, give a short, useful progress update when the result changes your next action; do not expose private chain-of-thought or hidden reasoning.",
            "Do not stop silently after a successful tool call.",
            "When the task is complete, provide a concise final response describing what you actually completed.",
          ].join("\n")
        : undefined;
      const runtimeSystem =
        [
          BASE_AGENT_SYSTEM_PROMPT,
          buildCurrentDateTimeSystemPrompt(),
          builtInRuntimeSystem,
          mcpRuntime?.systemPrompt,
          memoryRuntimeSystem,
          skillsRuntimeSystem,
          toolLoopRuntimeSystem,
        ]
          .filter((part): part is string => Boolean(part?.trim()))
          .join("\n\n") || undefined;

      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail: `${resolvedModel.providerLabel} · ${resolvedModel.label}`,
          kind: "run",
          status: "info",
          title: "Run started",
          createdAt: resumedRun?.startedAt ?? run.startedAt,
        }),
      );

      try {
        const modelArtifactInput = buildModelPromptArtifact({
          messages: runtimeMessages,
          model: resolvedModel,
          run,
          system: runtimeSystem,
        });
        const modelPromptFile =
          await workspaceServiceRef.current.createManagedTextFile({
            content: modelArtifactInput.content,
            folderSegments: ["prompts"],
            name: modelArtifactInput.fileName,
          });

        recordPromptArtifact(
          createPromptArtifactRecord({
            category: "model",
            displayName: modelPromptFile.displayName,
            fileId: modelPromptFile.id,
            relativePath: modelPromptFile.relativePath,
          }),
        );
      } catch (artifactError) {
        pushTimelineEvent(
          createExecutionTimelineEvent({
            detail:
              artifactError instanceof Error
                ? artifactError.message
                : String(artifactError),
            kind: "prompt",
            status: "failed",
            title: "Failed to save model prompt",
          }),
        );
      }

      if (runtimeTools && Object.keys(runtimeTools).length > 0) {
        try {
          const toolArtifactInput = buildToolContextArtifact({
            run,
            system: runtimeSystem,
            toolNames: Object.keys(runtimeTools),
          });
          const toolPromptFile =
            await workspaceServiceRef.current.createManagedTextFile({
              content: toolArtifactInput.content,
              folderSegments: ["tools"],
              name: toolArtifactInput.fileName,
            });

          recordPromptArtifact(
            createPromptArtifactRecord({
              category: "tool",
              displayName: toolPromptFile.displayName,
              fileId: toolPromptFile.id,
              relativePath: toolPromptFile.relativePath,
            }),
          );
        } catch (artifactError) {
          pushTimelineEvent(
            createExecutionTimelineEvent({
              detail:
                artifactError instanceof Error
                  ? artifactError.message
                  : String(artifactError),
              kind: "prompt",
              status: "failed",
              title: "Failed to save tool prompt",
            }),
          );
        }
      }

      const runtimeResult = await modelRuntime.generateTextStream({
        abortSignal: abortController.signal,
        maxToolSteps: snapshotRef.current.settings.maxToolSteps,
        messages: runtimeMessages,
        model: resolvedModel,
        onDelta: (delta) => {
          markActivity();
          assistantText += delta;
          schedulePersist("streaming");
          syncAssistantSnapshot("streaming");
        },
        onEvent: (eventName, data) => {
          markActivity();

          if (
            eventName !== "reasoning-start" &&
            eventName !== "reasoning-delta" &&
            eventName !== "reasoning-end"
          ) {
            return;
          }

          const event =
            data && typeof data === "object"
              ? (data as { id?: unknown; text?: unknown })
              : null;
          const id = typeof event?.id === "string" ? event.id : null;

          if (!id) {
            return;
          }

          let block = reasoning.find((item) => item.id === id);

          if (!block) {
            block = {
              id,
              text: "",
              startedAt: new Date().toISOString(),
              completedAt: null,
            };
            reasoning.push(block);
          }

          if (
            eventName === "reasoning-delta" &&
            typeof event?.text === "string"
          ) {
            block.text += event.text;
          }

          if (eventName === "reasoning-end") {
            block.completedAt = new Date().toISOString();
          }

          refreshAssistantState?.();
        },
        provider,
        reasoning: resolvedModel.supportsReasoning ? "medium" : undefined,
        secretStore: secureSecretStore,
        sessionId: run.id,
        system: runtimeSystem,
        tools: runtimeTools,
      });

      await Promise.allSettled(pendingArtifactWrites);

      assistantText = runtimeResult.text || assistantText;
      const generatedImages = await persistGeneratedImages(
        runtimeResult.generatedFiles ?? [],
      );

      if (!assistantText.trim() && generatedImages.length > 0) {
        assistantText = "Generated an image.";
      }

      if (!assistantText.trim()) {
        assistantText = runtimeResult.stepLimitReached
          ? `Stopped after ${snapshotRef.current.settings.maxToolSteps} tool steps. You can raise the limit in Tool settings or ask me to continue.`
          : toolExecutions.length > 0
            ? "The requested tool actions completed, but the model did not provide a final response. Please ask me to continue."
            : "The model completed without returning text.";
      }

      if (generatedImages.length > 0) {
        pushTimelineEvent(
          createExecutionTimelineEvent({
            detail: `${generatedImages.length} image${
              generatedImages.length === 1 ? "" : "s"
            }`,
            kind: "image",
            status: "completed",
            title: "Generated image output",
          }),
        );
      }

      const assistantUsage = buildUsageSnapshot({
        model: resolvedModel,
        usage: runtimeResult.usage,
      });
      const assistantMetadata = buildAssistantMetadata({
        appliedSkillIds,
        executionTimeline: [
          ...executionTimeline,
          createExecutionTimelineEvent({
            detail: null,
            kind: "run",
            status: "completed",
            title: "Run completed",
          }),
        ],
        generatedImages,
        memoryEvents,
        promptArtifacts,
        reasoning: reasoning.map((block) => ({
          ...block,
          completedAt: block.completedAt ?? new Date().toISOString(),
        })),
        runId: run.id,
        toolExecutions,
        usage: assistantUsage,
      });

      await flushPersist("completed", null, assistantMetadata);
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: null,
        status: "completed",
      });

      const [memories, workspaceFiles] = await Promise.all([
        repositories.memoryRepository.list(),
        repositories.workspaceRepository.list(),
      ]);

      setSnapshot((current) => {
        logMessageDebug("assistant-complete", {
          conversationId: conversation.id,
          currentConversationId: current.currentConversation?.id ?? null,
          shouldPatchMessages:
            current.currentConversation?.id === conversation.id,
          nextAssistantId: assistantMessage.id,
          currentMessages: buildMessageDebugSummary(current.messages),
        });

        return {
          ...current,
          messages:
            current.currentConversation?.id === conversation.id
              ? upsertMessages(current.messages, [
                  {
                    ...assistantMessage,
                    content: assistantText,
                    error: null,
                    metadata: assistantMetadata,
                    status: "completed",
                  },
                ])
              : current.messages,
          memories,
          workspaceFiles,
        };
      });

      if (conversation.title === "New chat") {
        void generateAndApplyConversationTitle({
          conversation,
          firstUserMessage: run.input,
          model: resolvedModel,
          provider,
          runId: run.id,
        });
      }

      await notifyRunStateChange({
        body: "Agent finished this task.",
        conversationId: conversation.id,
        title: conversation.title,
      }).catch(() => {});
    } catch (sendError) {
      await Promise.allSettled(pendingArtifactWrites);
      const requestAborted = abortController.signal.aborted;
      const errorMessage = requestAborted
        ? requestTimedOut
          ? "Request timed out. Please try again."
          : "Generation stopped."
        : sendError instanceof Error
          ? sendError.message
          : "Failed to send message.";
      const finalStatus =
        requestAborted && !requestTimedOut ? "canceled" : "failed";

      if (!assistantText) {
        assistantText = requestAborted
          ? requestTimedOut
            ? "This response took too long and was stopped. Try again."
            : "Stopped."
          : "Something went wrong. Please try again.";
      }

      const assistantMetadata = buildAssistantMetadata({
        executionTimeline: [
          ...executionTimeline,
          createExecutionTimelineEvent({
            detail: finalStatus === "failed" ? errorMessage : null,
            kind: "run",
            status: finalStatus === "failed" ? "failed" : "info",
            title: finalStatus === "failed" ? "Run failed" : "Run stopped",
          }),
        ],
        memoryEvents,
        promptArtifacts,
        reasoning: reasoning.map((block) => ({
          ...block,
          completedAt: block.completedAt ?? new Date().toISOString(),
        })),
        runId: run.id,
        toolExecutions,
      });

      await flushPersist(
        finalStatus === "canceled" ? "failed" : "failed",
        finalStatus === "canceled" ? null : errorMessage,
        assistantMetadata,
      );
      await updateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: finalStatus === "canceled" ? null : errorMessage,
        status: finalStatus,
      });

      if (
        finalStatus === "failed" &&
        snapshotRef.current.currentConversation?.id === conversation.id
      ) {
        setError(errorMessage);
      }

      const [memories, workspaceFiles] = await Promise.all([
        repositories.memoryRepository.list(),
        repositories.workspaceRepository.list(),
      ]);

      setSnapshot((current) => {
        logMessageDebug("assistant-failed", {
          conversationId: conversation.id,
          currentConversationId: current.currentConversation?.id ?? null,
          shouldPatchMessages:
            current.currentConversation?.id === conversation.id,
          nextAssistantId: assistantMessage.id,
          currentMessages: buildMessageDebugSummary(current.messages),
          finalStatus,
        });

        return {
          ...current,
          messages:
            current.currentConversation?.id === conversation.id
              ? upsertMessages(current.messages, [
                  {
                    ...assistantMessage,
                    content: assistantText,
                    error: finalStatus === "canceled" ? null : errorMessage,
                    metadata: assistantMetadata,
                    status: "failed",
                  },
                ])
              : current.messages,
          memories,
          workspaceFiles,
        };
      });

      if (finalStatus === "failed") {
        await notifyRunStateChange({
          body: errorMessage,
          conversationId: conversation.id,
          title: conversation.title,
        }).catch(() => {});
      }
    } finally {
      await mcpRuntime?.close();

      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }

      runRegistryRef.current.clear(run.id);
      setPendingToolApprovals((current) =>
        current.filter((approval) => approval.runId !== run.id),
      );
    }
  }

  async function resumePendingRuns() {
    const resumableRuns = snapshotRef.current.agentRuns.filter((run) =>
      shouldAutoResumeRun(run.status),
    );

    await Promise.all(
      resumableRuns.map(async (run) => {
        try {
          await executeAgentRun(run.id);
        } catch {}
      }),
    );
  }

  async function cancelRun(input?: {
    conversationId?: string;
    runId?: string;
  }) {
    const targetRun =
      (input?.runId
        ? snapshotRef.current.agentRuns.find((run) => run.id === input.runId)
        : null) ??
      snapshotRef.current.agentRuns.find((run) =>
        input?.conversationId
          ? run.conversationId === input.conversationId &&
            isActiveAgentRunStatus(run.status)
          : snapshotRef.current.currentConversation
            ? run.conversationId ===
                snapshotRef.current.currentConversation.id &&
              isActiveAgentRunStatus(run.status)
            : false,
      ) ??
      null;

    if (!targetRun) {
      return;
    }

    const ownedLocally = runRegistryRef.current.stopRun(targetRun.id);

    if (!ownedLocally) {
      await updateRunRecord(targetRun.id, {
        completedAt: new Date().toISOString(),
        lastError: null,
        status: "canceled",
      });
      await repositoriesRef.current.messageRepository.updateContent({
        id: targetRun.assistantMessageId,
        content: "Stopped.",
        error: null,
        metadata: {
          runId: targetRun.id,
        },
        status: "failed",
      });

      setSnapshot((current) => ({
        ...current,
        messages:
          current.currentConversation?.id === targetRun.conversationId
            ? upsertMessages(current.messages, [
                {
                  content: "Stopped.",
                  conversationId: targetRun.conversationId,
                  createdAt: targetRun.startedAt,
                  error: null,
                  id: targetRun.assistantMessageId,
                  metadata: {
                    runId: targetRun.id,
                  },
                  role: "assistant",
                  sequence: Number.MAX_SAFE_INTEGER,
                  status: "failed",
                  updatedAt: new Date().toISOString(),
                },
              ])
            : current.messages,
      }));
    }
  }

  async function stopSending() {
    await cancelRun({
      conversationId: snapshotRef.current.currentConversation?.id,
    });
  }

  async function sendMessage(input: SendMessageInput) {
    const cleanContent = input.content.trim();
    const selectedFileIds = Array.from(
      new Set(
        (
          input.selectedFileIds ?? snapshotRef.current.currentSelectedFileIds
        ).filter(Boolean),
      ),
    );

    if (!cleanContent && selectedFileIds.length === 0) {
      return;
    }

    const repositories = repositoriesRef.current;
    const activeConversation = snapshotRef.current.currentConversation;
    const currentModel = snapshotRef.current.resolvedConfig.currentModel;
    const fileContextSource = resolveFileContextSource({
      currentConversation: activeConversation,
      fileContextSource: input.fileContextSource,
      selectedFileIds,
    });
    const externalFolderSession =
      fileContextSource === "external-folder"
        ? (activeConversation?.externalFolderSession ?? null)
        : null;
    const selectedFiles = snapshotRef.current.workspaceFiles.filter((file) =>
      selectedFileIds.includes(file.id),
    );
    const { binaryFiles, imageFiles } = partitionSelectedFiles(selectedFiles);
    const failSend = (message: string): never => {
      logMessageDebug("send-fail", {
        activeConversationId: activeConversation?.id ?? null,
        currentConversationId:
          snapshotRef.current.currentConversation?.id ?? null,
        message,
        selectedFileIds,
      });
      setError(message);
      throw new Error(message);
    };

    if (!activeConversation) {
      failSend("No active conversation available.");
    }

    const conversation =
      activeConversation ?? failSend("No active conversation available.");

    logMessageDebug("send-start", {
      activeConversationId: activeConversation?.id ?? null,
      conversationId: conversation.id,
      inputLength: cleanContent.length,
      snapshotConversationId:
        snapshotRef.current.currentConversation?.id ?? null,
      snapshotMessages: buildMessageDebugSummary(snapshotRef.current.messages),
    });

    const existingRun =
      snapshotRef.current.agentRuns.find(
        (run) =>
          run.conversationId === conversation.id &&
          isActiveAgentRunStatus(run.status),
      ) ??
      (await repositories.agentRunRepository.getActiveByConversation(
        conversation.id,
      ));

    if (existingRun) {
      logMessageDebug("send-existing-run", {
        conversationId: conversation.id,
        existingRunId: existingRun.id,
        existingRunStatus: existingRun.status,
      });
      failSend(
        "This chat is still finishing the previous request. Wait for it to complete or stop it before sending again.",
      );
    }

    if (!currentModel) {
      failSend("No active model available. Configure a provider first.");
    }

    const model =
      currentModel ??
      failSend("No active model available. Configure a provider first.");

    const provider = snapshotRef.current.resolvedConfig.providers.find(
      (item) => item.id === model.providerId,
    );

    if (!provider) {
      failSend(`Provider ${model.providerId} is unavailable.`);
    }

    if (imageFiles.length > 0 && !model.supportsImageInput) {
      failSend(
        "The current model does not support image input. Switch to a vision-capable model to attach images.",
      );
    }

    if (
      (binaryFiles.length > 0 || fileContextSource === "external-folder") &&
      !model.supportsTools
    ) {
      failSend(
        "Tool access is unavailable for the current model. Use a tool-capable model for binary files or folder actions.",
      );
    }

    if (fileContextSource === "external-folder" && !externalFolderSession) {
      failSend("Pick a folder for this chat before using folder actions.");
    }

    setError(null);
    prepareRunNotificationsAsync().catch(() => {});

    const userSequence = await repositories.messageRepository.getNextSequence(
      conversation.id,
    );
    const assistantSequence = userSequence + 1;
    const timestamp = new Date().toISOString();
    const nextTitle = conversation.title;

    const updatedConversation: Conversation = {
      ...conversation,
      title: nextTitle,
      providerId: model.providerId,
      modelId: model.modelId,
      selectedFileIds,
      selectedSkillIds: conversation.selectedSkillIds,
      updatedAt: timestamp,
    };

    await repositories.conversationRepository.updateMetadata(conversation.id, {
      title: nextTitle,
      providerId: model.providerId,
      modelId: model.modelId,
      selectedFileIds,
      updatedAt: timestamp,
    });

    const appliedSkills = resolveAppliedSkills({
      content: cleanContent,
      selectedSkillIds: conversation.selectedSkillIds,
      skills: snapshotRef.current.skills,
    });
    const appliedSkillIds = appliedSkills.map((skill) => skill.id);
    const userMetadataEntries: MessageMetadata = {};

    if (selectedFileIds.length > 0 || fileContextSource === "external-folder") {
      userMetadataEntries.externalFolderDisplayName =
        externalFolderSession?.displayName ?? null;
      userMetadataEntries.fileContextSource = fileContextSource;

      if (selectedFileIds.length > 0) {
        userMetadataEntries.selectedFileIds = selectedFileIds;
      }
    }

    if (appliedSkillIds.length > 0) {
      userMetadataEntries.appliedSkillIds = appliedSkillIds;
    }

    const userMetadata: MessageMetadata | null =
      Object.keys(userMetadataEntries).length > 0 ? userMetadataEntries : null;
    const userMessage = await repositories.messageRepository.create({
      conversationId: conversation.id,
      content: cleanContent,
      metadata: userMetadata,
      role: "user",
      sequence: userSequence,
      status: "completed",
    });
    const assistantMessage = await repositories.messageRepository.create({
      conversationId: conversation.id,
      content: "",
      metadata: null,
      role: "assistant",
      sequence: assistantSequence,
      status: "streaming",
    });
    const agentRun = await repositories.agentRunRepository.create({
      assistantMessageId: assistantMessage.id,
      conversationId: conversation.id,
      externalFolderSession,
      fileContextSource,
      input: cleanContent,
      modelId: model.modelId,
      providerId: model.providerId,
      selectedFileIds,
      status: "queued",
      userMessageId: userMessage.id,
    });

    logMessageDebug("send-created-db-messages", {
      assistantMessageId: assistantMessage.id,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      userSequence,
      assistantSequence,
    });
    const assistantMetadata = buildAssistantMetadata({
      appliedSkillIds,
      executionTimeline: [
        createExecutionTimelineEvent({
          detail: `${model.providerLabel} · ${model.label}`,
          kind: "run",
          status: "pending",
          title: "Run queued",
          createdAt: agentRun.startedAt,
        }),
      ],
      runId: agentRun.id,
      toolExecutions: [],
    });

    await repositories.messageRepository.updateContent({
      id: assistantMessage.id,
      content: "",
      error: null,
      metadata: assistantMetadata,
      status: "streaming",
    });

    setSnapshot((current) => {
      logMessageDebug("send-before-live-patch", {
        conversationId: conversation.id,
        currentConversationId: current.currentConversation?.id ?? null,
        shouldPatchMessages:
          current.currentConversation?.id === conversation.id,
        currentMessages: buildMessageDebugSummary(current.messages),
        nextAssistantId: assistantMessage.id,
        nextUserId: userMessage.id,
      });

      return {
        ...current,
        agentRuns: upsertAgentRun(current.agentRuns, agentRun),
        conversations: upsertConversation(
          current.conversations,
          updatedConversation,
        ),
        currentConversation:
          current.currentConversation?.id === updatedConversation.id
            ? updatedConversation
            : current.currentConversation,
        currentSelectedFileIds:
          current.currentConversation?.id === conversation.id
            ? selectedFileIds
            : current.currentSelectedFileIds,
        currentSelectedSkillIds:
          current.currentConversation?.id === conversation.id
            ? conversation.selectedSkillIds
            : current.currentSelectedSkillIds,
        messages:
          current.currentConversation?.id === conversation.id
            ? upsertMessages(current.messages, [
                userMessage,
                {
                  ...assistantMessage,
                  metadata: assistantMetadata,
                },
              ])
            : current.messages,
      };
    });

    void executeAgentRun(agentRun.id).catch((runError) => {
      setError(
        runError instanceof Error ? runError.message : "Failed to start run.",
      );
    });
  }

  const sending = snapshot.agentRuns.some((run) =>
    isActiveAgentRunStatus(run.status),
  );
  const runStatusByConversation = buildRunStatusByConversation(
    snapshot.agentRuns,
  );
  const pendingToolApproval =
    pendingToolApprovals.find(
      (approval) =>
        approval.conversationId === snapshot.currentConversation?.id,
    ) ?? null;

  return (
    <AppStateContext.Provider
      value={{
        approvePendingToolApproval: () => {
          if (pendingToolApproval) {
            resolvePendingToolApproval(pendingToolApproval, "approve");
          }
        },
        agentRuns: snapshot.agentRuns,
        cancelRun,
        clearMcpServerCredentials,
        clearProviderApiKey,
        clearWorkspaceFiles,
        clearConversationFolder,
        connectMcpServerOAuth,
        connectOpenAIOAuth,
        createMcpServer,
        createMemory,
        createProvider,
        createConversation,
        deleteConversation,
        createModelPreset,
        createSkill,
        createWorkspaceFile,
        currentConversation: snapshot.currentConversation,
        currentExternalFolderSession:
          snapshot.currentConversation?.externalFolderSession ?? null,
        currentSelectedFileIds: snapshot.currentSelectedFileIds,
        currentSelectedSkillIds: snapshot.currentSelectedSkillIds,
        dismissInAppNotification,
        pendingToolApproval,
        denyPendingToolApproval: () => {
          if (pendingToolApproval) {
            resolvePendingToolApproval(pendingToolApproval, "deny");
          }
        },
        deleteMcpServer,
        deleteMemory,
        deleteModelPreset,
        deleteSkill,
        deleteWorkspaceFile,
        disconnectOpenAIOAuth,
        error,
        hydrating,
        importFiles,
        inAppNotification,
        messages: snapshot.messages,
        memories: snapshot.memories,
        mcpServers: snapshot.mcpServers,
        pickConversationFolder,
        ready,
        refresh,
        refreshWorkspaceFiles,
        resumePendingRuns,
        resolvedConfig: snapshot.resolvedConfig,
        runStatusByConversation,
        saveProviderApiKey,
        saveMcpServerHeaderValues,
        selectConversation,
        selectModel,
        sendMessage,
        sending,
        stopSending,
        setCurrentSelectedFileIds,
        setCurrentSelectedSkillIds,
        setDefaultModelPreset,
        settings: snapshot.settings,
        skills: snapshot.skills,
        testMcpServer,
        conversations: snapshot.conversations,
        updateMcpServer,
        updateDatabaseSettings,
        updateBuiltInToolSettings,
        updateMemory,
        updateMemoryEnabled,
        updateSkill,
        updateToolApprovalMode,
        updateThemeMode,
        updateMaxToolSteps,
        updateProvider,
        workspaceFiles: snapshot.workspaceFiles,
      }}
    >
      <ThemePreferenceController mode={snapshot.settings.themeMode} />
      {children}
    </AppStateContext.Provider>
  );
}

function useAppStateContext() {
  const context = useContext(AppStateContext);

  if (!context) {
    throw new Error("App state hooks must be used within AppStateProvider.");
  }

  return context;
}

export function useAppState() {
  const context = useAppStateContext();

  return {
    dismissInAppNotification: context.dismissInAppNotification,
    ready: context.ready,
    hydrating: context.hydrating,
    inAppNotification: context.inAppNotification,
    sending: context.sending,
    error: context.error,
    refresh: context.refresh,
    stopSending: context.stopSending,
  };
}

export function useConfig() {
  const context = useAppStateContext();

  return {
    ...context.resolvedConfig,
    clearMcpServerCredentials: context.clearMcpServerCredentials,
    clearProviderApiKey: context.clearProviderApiKey,
    connectMcpServerOAuth: context.connectMcpServerOAuth,
    connectOpenAIOAuth: context.connectOpenAIOAuth,
    createMcpServer: context.createMcpServer,
    createMemory: context.createMemory,
    createProvider: context.createProvider,
    createModelPreset: context.createModelPreset,
    createSkill: context.createSkill,
    createWorkspaceFile: context.createWorkspaceFile,
    deleteMcpServer: context.deleteMcpServer,
    deleteMemory: context.deleteMemory,
    deleteModelPreset: context.deleteModelPreset,
    deleteSkill: context.deleteSkill,
    deleteWorkspaceFile: context.deleteWorkspaceFile,
    disconnectOpenAIOAuth: context.disconnectOpenAIOAuth,
    currentModelSupportsImageGeneration:
      context.resolvedConfig.currentModelSupportsImageGeneration,
    currentModelSupportsImageInput:
      context.resolvedConfig.currentModelSupportsImageInput,
    currentModelSupportsTools: context.resolvedConfig.currentModelSupportsTools,
    importFiles: context.importFiles,
    memories: context.memories,
    memoryEnabled: context.settings.memoryEnabled,
    mcpServers: context.mcpServers,
    selectModel: context.selectModel,
    saveMcpServerHeaderValues: context.saveMcpServerHeaderValues,
    saveProviderApiKey: context.saveProviderApiKey,
    setDefaultModelPreset: context.setDefaultModelPreset,
    skills: context.skills,
    refresh: context.refresh,
    refreshWorkspaceFiles: context.refreshWorkspaceFiles,
    testMcpServer: context.testMcpServer,
    toolApprovalMode: context.settings.toolApprovalMode,
    themeMode: context.settings.themeMode,
    toolSettings: context.settings.builtInToolSettings,
    updateDatabaseSettings: context.updateDatabaseSettings,
    updateMcpServer: context.updateMcpServer,
    updateBuiltInToolSettings: context.updateBuiltInToolSettings,
    updateMemory: context.updateMemory,
    updateMemoryEnabled: context.updateMemoryEnabled,
    updateSkill: context.updateSkill,
    updateToolApprovalMode: context.updateToolApprovalMode,
    updateThemeMode: context.updateThemeMode,
    updateMaxToolSteps: context.updateMaxToolSteps,
    maxToolSteps: context.settings.maxToolSteps,
    updateProvider: context.updateProvider,
  };
}

export function useChat() {
  const context = useAppStateContext();
  const currentConversationRunStatus = context.currentConversation
    ? (context.runStatusByConversation[context.currentConversation.id] ?? null)
    : null;

  return {
    agentRuns: context.agentRuns,
    conversations: context.conversations,
    cancelRun: context.cancelRun,
    currentConversationRunStatus,
    currentConversation: context.currentConversation,
    currentExternalFolderSession: context.currentExternalFolderSession,
    currentSelectedSkillIds: context.currentSelectedSkillIds,
    pendingToolApproval: context.pendingToolApproval,
    approvePendingToolApproval: context.approvePendingToolApproval,
    denyPendingToolApproval: context.denyPendingToolApproval,
    createConversation: context.createConversation,
    createWorkspaceFile: context.createWorkspaceFile,
    clearConversationFolder: context.clearConversationFolder,
    clearWorkspaceFiles: context.clearWorkspaceFiles,
    deleteWorkspaceFile: context.deleteWorkspaceFile,
    currentSelectedFileIds: context.currentSelectedFileIds,
    importFiles: context.importFiles,
    messages: context.messages,
    pickConversationFolder: context.pickConversationFolder,
    resumePendingRuns: context.resumePendingRuns,
    runStatusByConversation: context.runStatusByConversation,
    selectConversation: context.selectConversation,
    sendMessage: context.sendMessage,
    skills: context.skills,
    sending:
      currentConversationRunStatus === "queued" ||
      currentConversationRunStatus === "running" ||
      currentConversationRunStatus === "waiting_for_approval" ||
      currentConversationRunStatus === "resumable",
    stopSending: context.stopSending,
    setCurrentSelectedFileIds: context.setCurrentSelectedFileIds,
    setCurrentSelectedSkillIds: context.setCurrentSelectedSkillIds,
    refreshWorkspaceFiles: context.refreshWorkspaceFiles,
    workspaceFiles: context.workspaceFiles,
    deleteConversation: context.deleteConversation,
  };
}
