import type { ModelMessage } from "ai";

import {
  BUILT_IN_FILE_TOOL_CONTROLS,
} from "@/lib/config/built-in-tools";
import { summarizeValue } from "@/lib/tools/built-in/shared";
import type {
  AgentRun,
  BuiltInToolSettings,
  Conversation,
  ExecutionTimelineEvent,
  ExternalFolderSession,
  FileContextSource,
  GeneratedImageAttachment,
  McpServerConfig,
  MemoryEvent,
  MessageMetadata,
  ModelUsageSnapshot,
  PromptArtifact,
  ReasoningBlock,
  ResolvedModel,
  SkillConfig,
  StoredMessage,
  ToolExecutionRecord,
  WorkspaceFile,
} from "@/types/app-state";

export function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function upsertConversation(
  conversations: Conversation[],
  conversation: Conversation,
) {
  const nextConversations = conversations.filter(
    (item) => item.id !== conversation.id,
  );

  nextConversations.push(conversation);

  return sortConversations(nextConversations);
}

export function upsertAgentRun(agentRuns: AgentRun[], agentRun: AgentRun) {
  const nextRuns = agentRuns.filter((item) => item.id !== agentRun.id);

  nextRuns.push(agentRun);

  return nextRuns.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function sortMessages(messages: StoredMessage[]) {
  return [...messages].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function buildMessageDebugSummary(messages: StoredMessage[]) {
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

export function logMessageDebug(label: string, data: Record<string, unknown>) {
  if (!__DEV__) {
    return;
  }
}

export function upsertMessages(
  currentMessages: StoredMessage[],
  nextMessages: StoredMessage[],
) {
  const map = new Map(currentMessages.map((message) => [message.id, message]));

  for (const message of nextMessages) {
    map.set(message.id, message);
  }

  return sortMessages([...map.values()]);
}

export function upsertWorkspaceFiles(
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

export function appendContextToLatestUserMessage(
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

export function resolveFileContextSource(input: {
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

export function filterToolsBySettings<T extends Record<string, unknown>>(
  tools: T,
  entries: [keyof T, boolean][],
) {
  return Object.fromEntries(
    entries
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key as string, tools[key]]),
  ) as Partial<T>;
}

export function hasEnabledWorkspaceTools(settings: BuiltInToolSettings) {
  return (
    settings.workspaceCreateFile ||
    settings.workspaceListFiles ||
    settings.workspaceReadFile ||
    settings.workspaceWriteFile
  );
}

export function hasEnabledFolderTools(settings: BuiltInToolSettings) {
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

export function normalizeApprovalPath(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().replace(/\\/g, "/");

  if (!normalized || normalized === ".") {
    return "";
  }

  return normalized.replace(/^\.\/+/, "");
}

export function buildExternalToolApprovalSummary(
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

export function summarizeToolInput(toolInput: unknown) {
  return summarizeValue(toolInput);
}

export function normalizeMatchText(value: string) {
  return value.trim().toLowerCase();
}

export function getMatchWords(value: string) {
  return normalizeMatchText(value)
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length >= 4);
}

export function skillMatchesInput(skill: SkillConfig, input: string) {
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

export function resolveAppliedSkills(input: {
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

export function buildSkillsSystemPrompt(input: {
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

export function normalizeMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildUsageSnapshot(input: {
  contextWindow?: number | null;
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
    contextWindow: normalizeMetric(input.contextWindow),
    remainingContext: null,
    contextUsagePercent: null,
  } satisfies ModelUsageSnapshot;
}

export function buildAssistantMetadata(input: {
  appliedSkillIds?: string[];
  executionTimeline?: ExecutionTimelineEvent[];
  generatedImages?: GeneratedImageAttachment[];
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

export function buildAssistantTextFromToolExecutions(
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
        entries?: { kind?: string; name?: string; path?: string }[];
      };
      const entries = parsed.entries ?? [];

      if (entries.length === 0) {
        return "The folder is empty.";
      }

      return [
        "Here's what I found:",
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

export function describePromptArtifactLocation(artifact: PromptArtifact) {
  return `${artifact.relativePath} (${artifact.displayName})`;
}

export function isCodexOAuthModel(modelId: string) {
  const CODEX_OAUTH_MODELS = new Set(["gpt-5.5"]);

  if (CODEX_OAUTH_MODELS.has(modelId)) {
    return true;
  }

  const version = modelId.match(/^gpt-(\d+\.\d+)/)?.[1];
  return version ? Number(version) > 5.4 : false;
}
