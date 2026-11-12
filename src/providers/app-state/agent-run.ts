import type { LanguageModelUsage, ModelMessage, ToolSet } from "ai";
import { updateReasoningPhase } from "@/modules/runtime/reasoning-stream";
import type { RefObject } from "react";

import {
  fetchModelsDevCatalogCached,
  findModelsDevModel,
} from "@/modules/config/models-dev-catalog";
import { resolveConfiguredModel } from "@/modules/config/registry";
import {
  listSubagents,
  resolveAgent,
} from "@/modules/agents/registry";
import {
  MUTATING_BUILT_IN_TOOL_NAMES,
  SUBAGENT_DEFAULT_DENIED_TOOL_NAMES,
  agentAllowsBuiltInKey,
  filterMcpServerIdsByAgentPermissions,
  isPlanAgent,
} from "@/modules/agents/permissions";
import {
  isOverflow,
  prepareMessagesForLLMWithSummary,
  type GenerateSummary,
} from "@/modules/context";
import {
  buildContextBreakdown,
  type ContextBreakdownSource,
} from "@/modules/context/breakdown";
import type { Repositories } from "@/core/db/repositories/types";
import { compactHistory } from "@/modules/context/manual-compaction";
import { calculateContextBudget } from "@/modules/context/overflow";
import { createSummaryMessage } from "@/modules/context/summarizer";
import { estimateMessagesTokens } from "@/modules/context/token-estimator";
import { combineUsage } from "@/modules/runtime/drivers/ai-sdk-runtime";
import type { GenerateModelTextStreamResult } from "@/modules/runtime/drivers/types";
import { createMcpRuntimeTools } from "@/modules/mcp/runtime-tools";
import { isMcpToolReadOnly } from "@/modules/mcp/read-only";
import {
  buildMemorySystemPrompt,
  createMemoryTools,
} from "@/modules/memory/memory-tools";
import { resolveOnDeviceRuntimePolicy } from "@/modules/on-device/runtime-policy";
import {
  convertStoredMessagesToModelMessages,
  isAudioMimeType,
  isVideoMimeType,
  partitionSelectedFiles,
} from "@/modules/runtime/message-conversion";
import { modelRuntime } from "@/modules/runtime/model-runtime";
import { attachmentInspectionContext, loadedSkillNames } from "@/modules/runtime/conversation-evidence";
import { NON_RETRYABLE_CHATGPT_SHARING_CODES } from "@/modules/providers/openai-chatgpt-oauth";
import {
  buildModelPromptArtifact,
  buildToolContextArtifact,
  buildToolExecutionArtifact,
  createExecutionTimelineEvent,
  createPromptArtifactRecord,
} from "@/modules/runtime/run-artifacts";
import {
  createRunControllerRegistry,
  shouldAutoResumeRun,
} from "@/modules/runtime/run-manager";
import { wrapToolsWithApproval } from "@/modules/runtime/tool-approval";
import { appendChatRenderError } from "@/core/services/chat-diagnostics";
import { secureSecretStore } from "@/core/services/secrets";
import type { PluginRuntimeSnapshot } from "@/modules/plugins/types";
import { createQuestionTool } from "@/modules/tools/built-in/question";
import {
  ANNOUNCE_WHEN_DONE_TOOL_NAME,
  createAnnounceWhenDoneTool,
  readAnnouncementRequest,
  type AnnouncementRequest,
} from "@/modules/tools/built-in/announce-when-done";
import { detectExplicitAnnouncementRequest } from "@/modules/notifications/announcement-policy";
import { createAgentTools } from "@/modules/tools/built-in/agent-tools";
import { createDownloadFileTool } from "@/modules/tools/built-in/download-file";
import { createScheduleTools } from "@/modules/tools/built-in/schedules";
import { createSkillTools } from "@/modules/tools/built-in/skill-tools";
import { createPluginTools } from "@/modules/tools/built-in/plugin-tools";
import { createSecretRequestTools } from "@/modules/tools/built-in/secret-request";
import {
  createTaskTool,
  describeSubagentCatalog,
  type SubagentTaskResult,
} from "@/modules/tools/built-in/task-tool";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import { createTodosTool } from "@/modules/tools/built-in/todos";
import {
  buildExternalFolderSystemPrompt,
  createExternalFolderTools,
} from "@/modules/tools/external-folder-tools";
import {
  buildTransferSystemPrompt,
  createTransferTools,
} from "@/modules/tools/built-in/external-folder/transfer";
import {
  startBackgroundAgent,
  stopBackgroundAgent,
} from "background-agent-service";
import { Platform } from "react-native";
import {
  dismissApprovalNotification,
  dismissQuestionNotification,
  dismissSecretNotification,
} from "@/modules/notifications/run-notifications";
import { collectGeneratedVideos } from "@/modules/tools/generated-videos";
import { persistGeneratedImages } from "@/modules/tools/generated-images";
import {
  buildSelectedFilesInlineContext,
  buildWorkspaceSystemPrompt,
  createWorkspaceTools,
} from "@/modules/tools/workspace-tools";
import type { WorkspaceFileService } from "@/core/services/workspace-file-service";
import type {
  AgentRun,
  AppStateSnapshot,
  BuiltInToolKey,
  Conversation,
  ExternalFolderSession,
  FileContextSource,
  MemoryEvent,
  MessageMetadata,
  PendingInput,
  PendingQuestionnaireAnswer,
  PendingQuestionnaireRequest,
  PendingSecretRequestAnswer,
  PendingSecretRequestRequest,
  PendingToolApprovalRequest,
  PromptArtifact,
  ProviderConfig,
  ReasoningBlock,
  ReasoningEffort,
  ResolvedModel,
  StoredMessage,
  ToolApprovalMode,
  ToolExecutionRecord,
  WorkspaceFile,
} from "@/core/types/app-state";
import {
  BASE_AGENT_SYSTEM_PROMPT,
  REQUEST_INACTIVITY_TIMEOUT_MS,
  STREAMING_SNAPSHOT_INTERVAL_MS,
  buildCurrentDateTimeSystemPrompt,
} from "./constants";
import {
  appendContextToLatestUserMessage,
  buildAssistantMetadata,
  buildExternalToolApprovalSummary,
  buildSkillsSystemPrompt,
  buildUsageSnapshot,
  describePromptArtifactLocation,
  pickEnabledTools,
  resolveAppliedSkills,
  upsertAgentRun,
  upsertMessages,
} from "./helpers";
import { isUiProjectionFailure, type RunUiPublisher } from "./run-ui-publisher";

const FOLDER_BOUND_TOOL_NAMES = new Set([
  "createDirectory",
  "deleteEntry",
  "downloadFile",
  "exportWorkspaceFileToFolder",
  "importFolderFileToWorkspace",
  "listDirectory",
  "moveEntry",
  "renameEntry",
]);

/**
 * Marks a steered prompt so the model cannot mistake it for old context.
 * Without an explicit marker, weaker models treat mid-run input as noise and
 * keep executing their previous plan (observed in the opencode #32157
 * incident report).
 */
function formatSteeredUserContent(content: string) {
  return [
    "[Steered input] The user sent this while you were already working. It is guidance for the task in progress, not a new task. Apply it to your next step and continue; only stop if it explicitly asks you to.",
    "",
    content,
  ].join("\n");
}

const WORKSPACE_AUTO_APPROVED_BUILT_IN_TOOL_NAMES = new Set([
  "analyzeAudio",
  "browser",
  "createFile",
  "edit",
  "fetchPage",
  "getVideoFrame",
  "glob",
  "grep",
  "listFiles",
  "listVoices",
  "previewMix",
  "previewScene",
  "read",
  "renderVideo",
  "textToSpeech",
  "transcribeAudio",
  "write",
]);

export type AgentRunDeps = {
  repositories: Repositories;
  snapshotRef: RefObject<AppStateSnapshot>;
  runRegistry: ReturnType<typeof createRunControllerRegistry>;
  workspaceService: WorkspaceFileService;
  updateRunRecord: (
    runId: string,
    input: Parameters<Repositories["agentRunRepository"]["update"]>[1],
  ) => Promise<AgentRun | null>;
  requestToolApproval: (
    run: AgentRun,
    request: PendingToolApprovalRequest,
  ) => Promise<import("@/modules/runtime/run-manager").ToolApprovalDecision>;
  requestRunQuestionnaire: (
    run: AgentRun,
    request: PendingQuestionnaireRequest,
  ) => Promise<PendingQuestionnaireAnswer[] | null>;
  requestSecretAnswer: (
    run: AgentRun,
    request: PendingSecretRequestRequest,
  ) => Promise<PendingSecretRequestAnswer>;
  generateAndApplyConversationTitle: (input: {
    conversation: Conversation;
    firstUserMessage: string;
    model: ResolvedModel;
    provider: ProviderConfig;
    runId: string;
  }) => Promise<void>;
  notifyRunStateChange: (input: {
    announcement?: AnnouncementRequest | null;
    body: string;
    conversationId: string;
    status: "success" | "failed";
    title: string;
  }) => Promise<void>;
  onSkillsChange: () => void;
  /** Refresh the snapshot + plugin runtime after plugins change via tools. */
  onPluginsChange: () => void;
  /** Refresh the snapshot after agents change via tools. */
  onAgentsChange: () => void;
  ui: RunUiPublisher;
  retryRun: (runId: string, delayMs: number) => void;
  /** Whether the background service should be kept alive after this run. */
  shouldKeepBackgroundAgentAlive: () => boolean;
  /** Ask the scheduler engine to re-scan schedules (after tool-driven CRUD). */
  refreshScheduler: () => void;
  /** Spawn and await a subagent task run. */
  spawnSubagent: (input: SubagentTaskInput) => Promise<SubagentTaskResult>;
  /**
   * Publish a newly created subagent chat into the live snapshot so it shows
   * up in the sidebar immediately instead of waiting for a re-hydrate.
   */
  publishSubagentConversation?: (input: {
    approvalMode?: ToolApprovalMode | null;
    approvedToolNames?: string[];
    conversation: Conversation;
  }) => void;
  /** Create a UI publisher that targets one child conversation. */
  createRunUi?: (input: {
    conversationId: string;
    runId: string;
  }) => RunUiPublisher;
  /** Promote queued input after a child run settles. */
  promoteAfterRun?: (runId: string) => void;
  /** Snapshot of loaded plugin hooks for this run. */
  pluginRuntimeSnapshot?: PluginRuntimeSnapshot;
};

function summarizeToolInput(toolInput: unknown) {
  return summarizeValue(toolInput);
}

function classifyRetryableError(error: unknown): {
  retryable: boolean;
  category: "transient" | "rate_limit" | "auth_expired" | "permanent";
} {
  const message =
    error instanceof Error ? error.message : String(error);

  if (
    NON_RETRYABLE_CHATGPT_SHARING_CODES.some((code) =>
      message.includes(code),
    )
  ) {
    return { retryable: false, category: "permanent" };
  }

  if (
    /timeout|timed ?out|network error|fetch failed|5\d\d|service unavailable|econnrefused|enotfound|socket hang up|request aborted/i.test(
      message,
    )
  ) {
    return { retryable: true, category: "transient" };
  }

  if (
    /429|rate limit|too many requests/i.test(message)
  ) {
    return { retryable: true, category: "rate_limit" };
  }

  if (
    /expired|token.*invalid|unauthorized|session expired/i.test(message)
  ) {
    return { retryable: true, category: "auth_expired" };
  }

  return { retryable: false, category: "permanent" };
}

function getRetryDelayMs(
  attempt: number,
  category: string,
): number {
  const baseDelay = category === "rate_limit" ? 5000 : 1000;
  const exponential = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponential + jitter, 30000);
}

export async function executeClaimedAgentRun(
  runId: string,
  deps: AgentRunDeps,
) {
  const {
    repositories,
    snapshotRef,
    runRegistry,
    workspaceService,
    updateRunRecord,
    requestToolApproval,
    requestRunQuestionnaire: requestRunQuestionnaireFromUi,
    requestSecretAnswer: requestSecretAnswerFromUi,
    generateAndApplyConversationTitle,
    notifyRunStateChange,
    ui,
    retryRun,
    shouldKeepBackgroundAgentAlive,
    refreshScheduler,
    onAgentsChange,
  } = deps;

  const pluginSnapshot = deps.pluginRuntimeSnapshot;
  if (runRegistry.isDisposed()) return;

  const run =
    snapshotRef.current.agentRuns.find((item) => item.id === runId) ??
    (await repositories.agentRunRepository.getById(runId));

  if (!run || !shouldAutoResumeRun(run.status)) {
    runRegistry.clear(runId);
    return;
  }

  const reportProjectionFailure = (context: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : null;
    void appendChatRenderError({
      context,
      message,
      runId: run.id,
      stack,
    });
  };

  const safeUpdateRunRecord: typeof updateRunRecord = async (
    safeRunId,
    input,
  ) => {
    if (runRegistry.isDisposed()) return null;
    try {
      return await updateRunRecord(safeRunId, input);
    } catch (error) {
      if (!isUiProjectionFailure(error)) {
        throw error;
      }
      reportProjectionFailure("updateRunRecord", error);
      return (await repositories.agentRunRepository.getById(safeRunId)) ?? null;
    }
  };

  const failAssistantMessage = async (
    message: StoredMessage,
    error: string,
  ) => {
    try {
      // Concise by design: full run context lives in diagnostics, not the console.
      console.warn(`[agent-run] run ${run.id} failed: ${error}`);
      await repositories.messageRepository.updateContent({
        id: message.id,
        content: message.content,
        error,
        metadata: message.metadata,
        status: "failed",
      });
      ui.publishSnapshot(
        (current) => ({
          ...current,
          messages:
            current.currentConversation?.id === run.conversationId
              ? upsertMessages(current.messages, [
                  {
                    ...message,
                    error,
                    status: "failed",
                  },
                ])
              : current.messages,
        }),
        { force: true },
      );
      ui.publishError(error);
    } catch (messageError) {
      console.warn("Failed to mark assistant message as failed.", messageError);
    }
  };

  const failAssistantMessageForRun = async (
    run2: AgentRun,
    error: string,
  ) => {
    try {
      const persistedMessages =
        await repositories.messageRepository.listByConversation(
          run2.conversationId,
        );
      const orphaned = persistedMessages.find(
        (message) =>
          message.id === run2.assistantMessageId ||
          message.status === "streaming",
      );
      if (orphaned) {
        await failAssistantMessage(orphaned, error);
      }
    } catch (lookupError) {
      console.warn(
        "Failed to locate assistant message for cleanup.",
        lookupError,
      );
    }
  };

  const conversation =
    snapshotRef.current.conversations.find(
      (item) => item.id === run.conversationId,
    ) ??
    (await repositories.conversationRepository.getById(run.conversationId));

  if (!conversation) {
    await failAssistantMessageForRun(run, "Chat not found.");
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: "Chat not found.",
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  const agent = resolveAgent(
    snapshotRef.current.agents,
    run.agentId ?? conversation.agentId,
  );
  const isPlanMode = isPlanAgent(agent);
  // Lineage is the source of truth: an "all"-mode agent can also run as a
  // subagent, and the child must keep subagent restrictions even if the user
  // opens its chat and sends a follow-up.
  const isSubagentRun = conversation.relationshipToParent === "subagent";

  const provider = snapshotRef.current.resolvedConfig.providers.find(
    (item) => item.id === run.providerId,
  );

  if (!provider) {
    await failAssistantMessageForRun(
      run,
      `Provider ${run.providerId} is unavailable.`,
    );
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: `Provider ${run.providerId} is unavailable.`,
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  let resolvedModel =
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
    // The saved model is gone (for example an account-scoped ChatGPT-plan
    // model after switching plans). Re-point the run at the provider's current
    // model instead of failing every retry with "model unavailable".
    const currentModel = snapshotRef.current.resolvedConfig.currentModel;

    if (currentModel && currentModel.providerId === run.providerId) {
      resolvedModel = currentModel;
      // Persist the switch so a retry of this run does not fall back to the
      // removed model again.
      await safeUpdateRunRecord(run.id, {
        modelId: currentModel.modelId,
        providerId: currentModel.providerId,
      }).catch(() => null);
    }
  }

  if (!resolvedModel) {
    await failAssistantMessageForRun(
      run,
      `Model ${run.modelId} is unavailable for ${provider.label}.`,
    );
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: `Model ${run.modelId} is unavailable for ${provider.label}.`,
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  const abortController = new AbortController();
  let requestTimedOut = false;
  let inactivityTimeout: ReturnType<typeof setTimeout> | null = null;

  runRegistry.registerAbortController(run.id, abortController);

  const scheduleInactivityTimeout = () => {
    if (inactivityTimeout) {
      clearTimeout(inactivityTimeout);
    }

    inactivityTimeout = setTimeout(() => {
      const latestRun = snapshotRef.current.agentRuns.find(
        (item) => item.id === run.id,
      );

      if (
        latestRun?.status === "waiting_for_approval" ||
        latestRun?.status === "waiting_for_question"
      ) {
        scheduleInactivityTimeout();
        return;
      }

      requestTimedOut = true;
      abortController.abort();
    }, REQUEST_INACTIVITY_TIMEOUT_MS);
  };

  const markActivity = () => {
    if (runRegistry.isDisposed()) return;
    scheduleInactivityTimeout();
  };

  const resumedRun = await safeUpdateRunRecord(run.id, {
    completedAt: null,
    lastError: null,
    resumeCount:
      run.status === "resumable" ? run.resumeCount + 1 : run.resumeCount,
    status: "running",
  });

  await pluginSnapshot?.dispatch("run:start", {
    conversationId: run.conversationId,
    runId: run.id,
  });

  const persistedMessages =
    await repositories.messageRepository.listByConversation(conversation.id);
  const assistantMessage = persistedMessages.find(
    (message) => message.id === run.assistantMessageId,
  );
  const userMessage = persistedMessages.find(
    (message) => message.id === run.userMessageId,
  );
  const manualCompaction = run.input.trim().toLowerCase() === "/compact";

  if (!assistantMessage) {
    const orphanedMessage = persistedMessages.find(
      (message) => message.status === "streaming",
    );
    if (orphanedMessage) {
      await failAssistantMessage(orphanedMessage, "Assistant message not found.");
    }
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: "Assistant message not found.",
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  const baseAssistantMetadata: MessageMetadata | null = {
    ...(assistantMessage.metadata ?? {}),
    agentName: agent.name,
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

  ui.publishSnapshot((current) => ({
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
  let selectedWorkspaceFiles: WorkspaceFile[] = [];
  if (referencedWorkspaceFileIds.length > 0) {
    try {
      selectedWorkspaceFiles =
        await repositories.workspaceRepository.getByIds(
          referencedWorkspaceFileIds,
        );
    } catch (workspaceError) {
      console.warn("Failed to load workspace files for run.", workspaceError);
    }
  }
  const workspaceFilesById = new Map(
    selectedWorkspaceFiles.map((file) => [file.id, file]),
  );
  const currentRunWorkspaceFiles = run.selectedFileIds
    .map((fileId) => workspaceFilesById.get(fileId))
    .filter((file): file is WorkspaceFile => file !== undefined);
  const { binaryFiles, imageFiles } = partitionSelectedFiles(
    currentRunWorkspaceFiles,
  );
  const onDevicePolicy = await resolveOnDeviceRuntimePolicy(resolvedModel).catch(
    (policyError) => {
      console.warn("Failed to resolve on-device runtime policy.", policyError);
      return {
        contextWindow: null,
        memoryConstrained: false,
        toolsEnabled: false,
        toolsMode: "auto" as const,
      };
    },
  );
  const runtimeSupportsTools = onDevicePolicy.toolsEnabled;

  if (imageFiles.length > 0 && !resolvedModel.supportsImageInput) {
    const errorMessage =
      "The current model does not support image input. Switch to a vision-capable model to send images.";
    await failAssistantMessage(assistantMessage, errorMessage);
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: errorMessage,
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  if (binaryFiles.length > 0 && !runtimeSupportsTools) {
    const errorMessage =
      onDevicePolicy.memoryConstrained && onDevicePolicy.toolsMode === "auto"
        ? "Tools are off in memory-safe mode. Enable tools for this model, then try the attachment again."
        : "Binary file attachments require a tool-capable model for this chat.";
    await failAssistantMessage(assistantMessage, errorMessage);
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: errorMessage,
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  let runtimeMessageResult: Awaited<
    ReturnType<typeof convertStoredMessagesToModelMessages>
  >;
  try {
    runtimeMessageResult = await convertStoredMessagesToModelMessages({
      messages: persistedMessages.filter(
        (message) => message.id !== assistantMessage.id &&
          (!manualCompaction || message.id !== run.userMessageId),
      ),
      supportsImageInput: resolvedModel.supportsImageInput,
      supportsAudioInput: resolvedModel.supportsAudioInput,
      supportsVideoInput: resolvedModel.supportsVideoInput,
      workspaceFilesById,
    });
  } catch (conversionError) {
    const errorMessage =
      conversionError instanceof Error
        ? conversionError.message
        : "Unable to prepare your conversation for the model.";
    console.warn("Failed to convert stored messages for the model.", conversionError);
    await failAssistantMessage(assistantMessage, errorMessage);
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: errorMessage,
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  if (runtimeMessageResult.unsupportedAttachments.length > 0) {
    const shortName = (name: string) =>
      name.length > 40 ? `${name.slice(0, 37)}...` : name;
    const isReroutable = (file: { mimeType: string | null }) =>
      isAudioMimeType(file.mimeType) || isVideoMimeType(file.mimeType) ||
      (runtimeSupportsTools && resolvedModel.supportsImageInput && file.mimeType?.startsWith("image/"));
    const reroutable = runtimeMessageResult.unsupportedAttachments.filter(
      isReroutable,
    );
    const blocking = runtimeMessageResult.unsupportedAttachments.filter(
      (file) => !isReroutable(file),
    );

    if (blocking.length > 0) {
      const names = blocking.slice(0, 5).map((file) => shortName(file.displayName)).join(", ");
      const memoryLimited = runtimeMessageResult.memoryLimitedAttachments.length > 0;
      const errorMessage = memoryLimited
        ? "This chat exceeds the mobile direct-media limit (20 files / 25 MB across history). Use a tool-capable vision model to inspect files individually, or start a new chat with a smaller batch."
        : `I can't read these attachments with the current model: ${names}.`;
      await failAssistantMessage(
        assistantMessage,
        errorMessage,
      );
      await safeUpdateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: errorMessage,
        status: "failed",
      });
      runRegistry.clear(runId);
      return;
    }

    // Media the model can't ingest directly are rerouted through tools
    // instead of failing the run: tell the model what arrived and which tool
    // reads it, then let it proceed with the user's request.
    appendContextToLatestUserMessage(
      runtimeMessageResult.messages,
      attachmentInspectionContext(reroutable),
    );
  }

  let runtimeMessages = runtimeMessageResult.messages;
  const toolExecutions = [
    ...(assistantMessage.metadata?.toolExecutions ?? []),
  ] as ToolExecutionRecord[];
  let announcementRequest: AnnouncementRequest | null = null;
  const resolveAnnouncementRequest = (): AnnouncementRequest | null =>
    announcementRequest ??
    readAnnouncementRequest(toolExecutions) ??
    (detectExplicitAnnouncementRequest(run.input) ? { message: null } : null);
  const toolRunAnchors = new Map(
    [
      ...(assistantMessage.metadata?.termuxRunAnchors ?? []),
      ...(assistantMessage.metadata?.toolRunAnchors ?? []),
    ].map((anchor) => [
      anchor.executionId,
      anchor.textOffset,
    ]),
  );
  const memoryEvents = [
    ...(assistantMessage.metadata?.memoryEvents ?? []),
  ] as MemoryEvent[];
  const promptArtifacts = [
    ...(assistantMessage.metadata?.promptArtifacts ?? []),
  ] as PromptArtifact[];
  const reasoning = [
    ...(assistantMessage.metadata?.reasoning ?? []),
  ] as ReasoningBlock[];
  let traceOrder = Math.max(-1, ...toolExecutions.map((record) => record.traceOrder ?? -1), ...reasoning.map((block) => block.traceOrder ?? -1)) + 1;
  const activeReasoning = new Map<string, ReasoningBlock>();
  const executionTimeline = [
    ...(assistantMessage.metadata?.executionTimeline ?? []),
  ] as import("@/core/types/app-state").ExecutionTimelineEvent[];
  const todoList = [
    ...(assistantMessage.metadata?.todoList ?? []),
  ] as import("@/core/types/app-state").TodoListItem[];
  const appliedSkillIds =
    assistantMessage.metadata?.appliedSkillIds ??
    userMessage?.metadata?.appliedSkillIds ??
    [];
  const useInlineFileContext =
    run.fileContextSource === "workspace" &&
    currentRunWorkspaceFiles.length > 0;
  const externalFolderSession: ExternalFolderSession | null =
    run.fileContextSource === "external-folder"
      ? (run.externalFolderSession ?? conversation.externalFolderSession)
      : null;
  const activeFolderSession: ExternalFolderSession | null =
    conversation.externalFolderSession;
  const conversationMcpServers =
    conversation.selectedMcpServerIds === null
      ? snapshotRef.current.mcpServers
      : snapshotRef.current.mcpServers.filter((server) =>
          conversation.selectedMcpServerIds!.includes(server.id),
        );
  const runMcpServers = filterMcpServerIdsByAgentPermissions(
    conversationMcpServers.map((server) => server.id),
    agent,
  )
    .map((serverId) =>
      conversationMcpServers.find((server) => server.id === serverId),
    )
    .filter((server): server is NonNullable<typeof server> => Boolean(server));
  const selectedWorkspaceToolFileIds = currentRunWorkspaceFiles.map(
    (file) => file.id,
  );

  const pushTimelineEvent = (
    event: import("@/core/types/app-state").ExecutionTimelineEvent,
  ) => {
    executionTimeline.push(event);
  };

  const contextCompactions = [...(assistantMessage.metadata?.contextCompactions ?? [])];
  const buildLiveAssistantMetadata = () =>
    buildAssistantMetadata({
      contextCompactions,
      appliedSkillIds,
      executionTimeline,
      memoryEvents,
      promptArtifacts,
      pluginOutputs: pluginSnapshot?.pluginOutputs,
      reasoning,
      runId: run.id,
      toolRunAnchors: Array.from(
        toolRunAnchors,
        ([executionId, textOffset]) => ({ executionId, textOffset }),
      ),
      todoList,
      toolExecutions,
    });

  const setRunWaitingForApproval = async () => {
    await safeUpdateRunRecord(run.id, {
      lastError: null,
      status: "waiting_for_approval",
    });
  };

  const setRunWaitingForQuestion = async () => {
    await safeUpdateRunRecord(run.id, {
      lastError: null,
      status: "waiting_for_question",
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

    let decision: import("@/modules/runtime/run-manager").ToolApprovalDecision;
    try {
      decision = await requestToolApproval(run, request);
    } catch (error) {
      if (!isUiProjectionFailure(error)) {
        throw error;
      }
      reportProjectionFailure("request-tool-approval", error);
      runRegistry.stopRun(run.id);
      await safeUpdateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: null,
        status: "canceled",
      });
      return "abort";
    }
    markActivity();

    if (decision !== "abort") {
      await safeUpdateRunRecord(run.id, {
        lastError: null,
        status: "running",
      });
    }

    return decision;
  };
  const requestRunQuestionnaire = async (
    request: PendingQuestionnaireRequest,
  ): Promise<PendingQuestionnaireAnswer[] | null> => {
    pushTimelineEvent(
      createExecutionTimelineEvent({
        detail: request.items.map((item) => item.prompt).join(" / "),
        kind: "tool",
        status: "pending",
        title: "Questions for the user",
      }),
    );
    refreshAssistantState?.();
    await setRunWaitingForQuestion();

    let answers: PendingQuestionnaireAnswer[] | null;
    try {
      answers = await requestRunQuestionnaireFromUi(run, request);
    } catch (error) {
      if (!isUiProjectionFailure(error)) {
        throw error;
      }
      reportProjectionFailure("request-questionnaire", error);
      runRegistry.stopRun(run.id);
      await safeUpdateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: null,
        status: "canceled",
      });
      return null;
    }
    markActivity();
    await safeUpdateRunRecord(run.id, {
      lastError: null,
      status: "running",
    });

    return answers;
  };
  const requestRunSecret = async (
    request: PendingSecretRequestRequest,
  ): Promise<PendingSecretRequestAnswer> => {
    pushTimelineEvent(
      createExecutionTimelineEvent({
        detail: `${request.scope === "plugin" ? request.pluginId : request.scope} / ${request.key}`,
        kind: "tool",
        status: "pending",
        title: `Secret requested for ${request.key}`,
      }),
    );
    refreshAssistantState?.();
    await setRunWaitingForQuestion();

    let answer: PendingSecretRequestAnswer;
    try {
      answer = await requestSecretAnswerFromUi(run, request);
    } catch (error) {
      if (!isUiProjectionFailure(error)) {
        throw error;
      }
      reportProjectionFailure("request-secret", error);
      runRegistry.stopRun(run.id);
      await safeUpdateRunRecord(run.id, {
        completedAt: new Date().toISOString(),
        lastError: null,
        status: "canceled",
      });
      return { status: "aborted" };
    }
    markActivity();
    await safeUpdateRunRecord(run.id, {
      lastError: null,
      status: "running",
    });

    return answer;
  };
  let refreshAssistantState: null | (() => void) = null;
  const pendingArtifactWrites: Promise<void>[] = [];
  let assistantText = startingAssistantText;
  // A mid-run steer splits the assistant's single message row: text
  // streamed before the steer is finalized on the current row, the steer
  // entries land next, and a fresh continuation row receives everything
  // after it. Without the split a steer row always sorts below the entire
  // (still-growing) response, which reads as "the steer landed at the end".
  let activeAssistantMessage = assistantMessage;
  let assistantSplitCharOffset = 0;
  let persistTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSnapshotTime = 0;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshotStatus: StoredMessage["status"] | null = null;
  let pendingSnapshotError: string | null = null;

  const syncAssistantSnapshot = (
    status: StoredMessage["status"],
    errorMessage: string | null = null,
  ) => {
    const metadata = buildLiveAssistantMetadata();

    ui.publishSnapshot((current) => {
      if (current.currentConversation?.id !== conversation.id) {
        return current;
      }

      return {
        ...current,
        messages: current.messages.map((msg) =>
          msg.id === activeAssistantMessage.id
            ? {
                ...msg,
                content: assistantText,
                error: errorMessage,
                metadata,
                status,
              }
            : msg,
        ),
      };
    });
  };

  const scheduleSnapshot = (
    status: StoredMessage["status"],
    errorMessage: string | null = null,
  ) => {
    pendingSnapshotStatus = status;
    pendingSnapshotError = errorMessage;

    if (snapshotTimer) {
      return;
    }

    const delay = Math.max(
      0,
      STREAMING_SNAPSHOT_INTERVAL_MS - (Date.now() - lastSnapshotTime),
    );

    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      lastSnapshotTime = Date.now();
      syncAssistantSnapshot(
        pendingSnapshotStatus ?? "streaming",
        pendingSnapshotError,
      );
    }, delay);
  };

  const schedulePersist = (status: StoredMessage["status"]) => {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }

    persistTimeout = setTimeout(() => {
      persistTimeout = null;
      if (runRegistry.isDisposed()) return;
      repositories.messageRepository
        .updateContent({
          id: activeAssistantMessage.id,
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
    if (runRegistry.isDisposed()) {
      throw new Error("Run interrupted: its database provider was disposed.");
    }
    if (status === "completed" && abortController.signal.aborted) {
      throw new Error(requestTimedOut ? "Request timed out. Please try again." : "Generation stopped.");
    }
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }

    if (status !== "streaming" && snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }

    await repositories.messageRepository.updateContent({
      id: activeAssistantMessage.id,
      content: assistantText,
      error: errorMessage,
      metadata,
      status,
    });
  };

  refreshAssistantState = () => {
    if (runRegistry.isDisposed()) return;
    schedulePersist("streaming");
    scheduleSnapshot("streaming");
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
      const file = await workspaceService.createManagedTextFile({
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
    if (runRegistry.isDisposed()) return;
    // Built-in tools also emit records without IDs. Give them an identity
    // before anchoring, rather than sending them to an end-of-message fallback.
    record = { ...record, id: record.id ?? `${run.id}:tool:${traceOrder}` };
    // Anchor every tool execution at the current text position, so its row
    // can render inline in the reply where the model wrote around it.
    if (record.id && !toolRunAnchors.has(record.id)) {
      toolRunAnchors.set(record.id, assistantText.length);
    }
    const existingIndex = record.id
      ? toolExecutions.findIndex((existing) => existing.id === record.id)
      : -1;
    record = {
      ...record,
      traceOrder: (existingIndex >= 0 ? toolExecutions[existingIndex].traceOrder : undefined) ?? traceOrder++,
    };
    if (existingIndex >= 0) {
      toolExecutions[existingIndex] = record;
    } else {
      toolExecutions.push(record);
    }
    if (record.status === "running") {
      markActivity();
      refreshAssistantState?.();
      return;
    }
    void pluginSnapshot?.dispatch("tool:after", {
      conversationId: run.conversationId,
      record,
      runId: run.id,
    })?.catch(() => {});
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

  const handleBackgroundTaskComplete = async (
    completion: import("@/modules/mcp/runtime-tools").TermuxBackgroundCompletion,
  ) => {
    if (runRegistry.isDisposed()) return;
    try {
      const completedRecord = createRecord({
        id: completion.executionId,
        toolName: completion.toolName,
        status: "completed",
        inputSummary: summarizeValue({ command: completion.command }),
        outputSummary: summarizeValue(completion.output),
        termux: {
          command: completion.command,
          output: completion.output,
          taskId: completion.taskId,
        },
      });
      const backgroundCompletionEvent = createExecutionTimelineEvent({
        detail:
          completion.state === "failed"
            ? `exit code ${completion.exitCode ?? "unknown"}`
            : (completedRecord.outputSummary ?? completedRecord.inputSummary),
        kind: "tool",
        status: "completed",
        title: `Background ${completion.toolName} completed`,
        createdAt: new Date().toISOString(),
      });

      const existingIndex = toolExecutions.findIndex(
        (existing) => existing.id === completion.executionId,
      );
      if (existingIndex >= 0) {
        toolExecutions[existingIndex] = completedRecord;
      } else {
        toolExecutions.push(completedRecord);
      }

      const storedMessages =
        await repositories.messageRepository.listByConversation(conversation.id);
      const storedMessage = storedMessages.find(
        (message) => message.id === activeAssistantMessage.id,
      );
      if (!storedMessage) {
        pushTimelineEvent(backgroundCompletionEvent);
        markActivity();
        if (runRegistry.owns(run.id)) {
          refreshAssistantState?.();
        }
        return;
      }

      const storedMetadata = storedMessage.metadata ?? {};
      const storedExecutions = (storedMetadata.toolExecutions ??
        []) as ToolExecutionRecord[];
      const mergedExecutions = [...storedExecutions];
      const mergedIndex = mergedExecutions.findIndex(
        (execution) => execution.id === completion.executionId,
      );
      if (mergedIndex >= 0) {
        mergedExecutions[mergedIndex] = completedRecord;
      } else {
        mergedExecutions.push(completedRecord);
      }

      const storedTimeline = (storedMetadata.executionTimeline ??
        []) as import("@/core/types/app-state").ExecutionTimelineEvent[];
      const mergedPluginOutputs = [
        ...(storedMetadata.pluginOutputs ?? []),
        ...(pluginSnapshot?.pluginOutputs ?? []).filter(
          (entry) =>
            !(storedMetadata.pluginOutputs ?? []).some(
              (existing) =>
                existing.pluginId === entry.pluginId &&
                existing.toolName === entry.toolName &&
                existing.output === entry.output,
            ),
        ),
      ];
      const nextMetadata: MessageMetadata = {
        ...storedMetadata,
        executionTimeline: [...storedTimeline, backgroundCompletionEvent],
        pluginOutputs: mergedPluginOutputs,
        toolRunAnchors: Array.from(
          toolRunAnchors,
          ([executionId, textOffset]) => ({ executionId, textOffset }),
        ),
        toolExecutions: mergedExecutions,
      };

      await repositories.messageRepository.updateContent({
        id: storedMessage.id,
        content: storedMessage.content,
        error: storedMessage.error,
        metadata: nextMetadata,
        status: storedMessage.status,
      });

      ui.publishSnapshot(
        (current) => ({
          ...current,
          messages:
            current.currentConversation?.id === conversation.id
              ? upsertMessages(current.messages, [
                  {
                    ...storedMessage,
                    metadata: nextMetadata,
                  },
                ])
              : current.messages,
        }),
        { force: true },
      );

      if (storedMessage.status === "streaming" && runRegistry.owns(run.id)) {
        pushTimelineEvent(backgroundCompletionEvent);
        markActivity();
      }
    } catch {}
  };

  try {
    if (Platform.OS === "android") {
      startBackgroundAgent();
    }

    if (isPlanMode) {
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail:
            "Only read-only tools are available. The agent will research and present a plan without making changes.",
          kind: "run",
          status: "info",
          title: "Plan mode",
          createdAt: new Date().toISOString(),
        }),
      );
    }

    const builtInRuntimeTools: ToolSet | undefined = runtimeSupportsTools
      ? (() => {
          const tools: Record<string, unknown> = {};
          const toolSettings =
            snapshotRef.current.settings.builtInToolSettings;
          const enabledFor = (key: BuiltInToolKey) =>
            toolSettings[key] && agentAllowsBuiltInKey(agent, key);

          if (run.fileContextSource === "external-folder") {
            const folderTools = createExternalFolderTools({
              session: externalFolderSession as ExternalFolderSession,
              onRecord: handleToolExecutionRecord,
              supportsImageInput: resolvedModel.supportsImageInput,
              supportsAudioInput: resolvedModel.supportsAudioInput,
              supportsVideoInput: resolvedModel.supportsVideoInput,
            }).tools;

            Object.assign(
              tools,
              pickEnabledTools(folderTools, [
                ["createDirectory", enabledFor("folderCreateDirectory")],
                ["createFile", enabledFor("folderCreateFile")],
                ["deleteEntry", enabledFor("folderDeleteEntry")],
                ["edit", enabledFor("folderEdit")],
                ["glob", enabledFor("folderGlob")],
                ["grep", enabledFor("folderGrep")],
                ["listDirectory", enabledFor("folderListDirectory")],
                ["moveEntry", enabledFor("folderMoveEntry")],
                ["read", enabledFor("folderRead")],
                ["renameEntry", enabledFor("folderRenameEntry")],
                ["viewFile", enabledFor("folderRead")],
                ["write", enabledFor("folderWrite")],
              ]),
            );

            Object.assign(
              tools,
              pickEnabledTools(
                {
                  downloadFile: createDownloadFileTool({
                    repository: repositories.workspaceRepository,
                    session: externalFolderSession as ExternalFolderSession,
                    onProgress: () => markActivity(),
                    onRecord: handleToolExecutionRecord,
                  }),
                },
                [["downloadFile", enabledFor("downloadFile")]],
              ),
            );

            const workspaceDiscoveryTools = createWorkspaceTools({
              repository: repositories.workspaceRepository,
              onRecord: handleToolExecutionRecord,
              // Without this, long renders in folder chats never reset the
              // inactivity timer and the run aborts at 5 min mid-render.
              onProgress: () => markActivity(),
              supportsImageInput: resolvedModel.supportsImageInput,
              supportsAudioInput: resolvedModel.supportsAudioInput,
              supportsVideoInput: resolvedModel.supportsVideoInput,
            }).tools;

            Object.assign(
              tools,
              pickEnabledTools(workspaceDiscoveryTools, [
                ["listFiles", enabledFor("workspaceListFiles")],
                ["fetchPage", enabledFor("workspaceFetchPage")],
                ["browser", enabledFor("workspaceFetchPage")],
                // Video rendering/inspection are workspace-backed but not
                // folder-scoped: folder chats still need them, otherwise the
                // skill references tools the model cannot see.
                ["renderVideo", enabledFor("workspaceRenderVideo")],
                ["getVideoFrame", enabledFor("workspaceRenderVideo")],
                ["previewScene", enabledFor("workspaceRenderVideo")],
                ["previewMix", enabledFor("workspaceRenderVideo")],
                ["listVoices", enabledFor("workspaceRenderVideo")],
                ["textToSpeech", enabledFor("workspaceRenderVideo")],
                ["analyzeAudio", enabledFor("workspaceRenderVideo")],
                ["transcribeAudio", enabledFor("workspaceRenderVideo")],
              ]),
            );
          } else {
            const workspaceTools = createWorkspaceTools({
              repository: repositories.workspaceRepository,
              session: activeFolderSession,
              onRecord: handleToolExecutionRecord,
              onProgress: () => markActivity(),
              supportsImageInput: resolvedModel.supportsImageInput,
              supportsAudioInput: resolvedModel.supportsAudioInput,
              supportsVideoInput: resolvedModel.supportsVideoInput,
            }).tools;

            Object.assign(
              tools,
              pickEnabledTools(workspaceTools, [
                ["analyzeAudio", enabledFor("workspaceRenderVideo")],
                ["createFile", enabledFor("workspaceCreateFile")],
                ["downloadFile", enabledFor("downloadFile")],
                ["edit", enabledFor("workspaceEdit")],
                ["getVideoFrame", enabledFor("workspaceRenderVideo")],
                ["glob", enabledFor("workspaceGlob")],
                ["fetchPage", enabledFor("workspaceFetchPage")],
                ["grep", enabledFor("workspaceGrep")],
                ["listFiles", enabledFor("workspaceListFiles")],
                ["listVoices", enabledFor("workspaceRenderVideo")],
                ["mergeDocuments", enabledFor("workspaceCreateFile")],
                ["mergePdfs", enabledFor("workspaceCreateFile")],
                ["ocr", enabledFor("workspaceRead")],
                ["previewMix", enabledFor("workspaceRenderVideo")],
                ["previewScene", enabledFor("workspaceRenderVideo")],
                ["read", enabledFor("workspaceRead")],
                ["renderVideo", enabledFor("workspaceRenderVideo")],
                ["browser", enabledFor("workspaceFetchPage")],
                ["splitDocument", enabledFor("workspaceCreateFile")],
                ["splitPdf", enabledFor("workspaceCreateFile")],
                ["textToSpeech", enabledFor("workspaceRenderVideo")],
                ["transcribeAudio", enabledFor("workspaceRenderVideo")],
                ["updateDocument", enabledFor("workspaceEdit")],
                ["viewFile", enabledFor("workspaceRead")],
                ["write", enabledFor("workspaceWrite")],
              ]),
            );

            if (activeFolderSession) {
              const folderDiscoveryTools = createExternalFolderTools({
                session: activeFolderSession,
                onRecord: handleToolExecutionRecord,
                supportsImageInput: resolvedModel.supportsImageInput,
                supportsAudioInput: resolvedModel.supportsAudioInput,
                supportsVideoInput: resolvedModel.supportsVideoInput,
              }).tools;

              Object.assign(
                tools,
                pickEnabledTools(folderDiscoveryTools, [
                  ["listDirectory", enabledFor("folderListDirectory")],
                  ["viewFile", enabledFor("folderRead")],
                ]),
              );
            }
          }

          if (activeFolderSession) {
            const transferEnabled =
              enabledFor("folderRead") &&
              enabledFor("folderWrite") &&
              !isPlanMode;

            if (transferEnabled) {
              Object.assign(
                tools,
                createTransferTools({
                  repository: repositories.workspaceRepository,
                  session: activeFolderSession,
                  onRecord: handleToolExecutionRecord,
                }),
              );
            }
          }

          if (!isPlanMode) {
            return Object.keys(tools).length > 0 ? (tools as ToolSet) : undefined;
          }

          return Object.keys(tools).length > 0
            ? (Object.fromEntries(
                Object.entries(tools).filter(
                  ([name]) => !MUTATING_BUILT_IN_TOOL_NAMES.has(name),
                ),
              ) as ToolSet)
            : undefined;
        })()
      : undefined;
    mcpRuntime =
      runtimeSupportsTools && runMcpServers.length > 0
         ? await createMcpRuntimeTools({
             servers: runMcpServers,
             onRecord: handleToolExecutionRecord,
             onBackgroundTaskComplete: handleBackgroundTaskComplete,
             signal: abortController.signal,
             keepTool: isPlanMode
               ? (tool) => isMcpToolReadOnly(tool)
               : undefined,
           })
        : null;
    const memoryRuntime =
      runtimeSupportsTools &&
      !isPlanMode &&
      !isSubagentRun &&
      snapshotRef.current.settings.memoryEnabled
        ? createMemoryTools({
            conversationId: conversation.id,
            memoryStore: repositories.memoryStore,
            sourceMessageId: assistantMessage.id,
            onEvent: (event) => {
              memoryEvents.push(event);
              markActivity();
            },
          })
        : null;
    const todosRuntime =
      runtimeSupportsTools &&
      !isSubagentRun &&
      snapshotRef.current.settings.builtInToolSettings.todos
        ? createTodosTool({
            getCurrentTodos: () => todoList,
            onRecord: handleToolExecutionRecord,
            onTodosChange: (next) => {
              todoList.length = 0;
              todoList.push(...next);
              markActivity();
              refreshAssistantState?.();
            },
          })
        : null;
    const questionRuntime =
      runtimeSupportsTools &&
      !isSubagentRun &&
      snapshotRef.current.settings.builtInToolSettings.question
        ? createQuestionTool({
            onRecord: handleToolExecutionRecord,
            requestQuestionnaire: (request) => requestRunQuestionnaire(request),
          })
        : null;
    const skillRuntime =
      runtimeSupportsTools && agentAllowsBuiltInKey(agent, "skill")
        ? createSkillTools({
            onRecord: handleToolExecutionRecord,
            onSkillsChange: () => {
              deps.onSkillsChange();
              markActivity();
            },
            repository: repositories.skillRepository,
          })
        : null;
    const scheduleRuntime =
      runtimeSupportsTools &&
      !isPlanMode &&
      !isSubagentRun &&
      agentAllowsBuiltInKey(agent, "schedules")
        ? createScheduleTools({
            onRecord: handleToolExecutionRecord,
            refreshScheduler: () => {
              refreshScheduler();
              markActivity();
            },
            repositories,
          })
        : null;
    const taskRuntime =
      runtimeSupportsTools && !isPlanMode && !isSubagentRun
        ? createTaskTool({
            getAgents: () => snapshotRef.current.agents,
            onRecord: handleToolExecutionRecord,
            spawnSubagent: async (task) => {
              // The parent is blocked inside the tool call, so it must keep
              // its inactivity timer warm or a long subagent would abort it.
              const heartbeat = setInterval(markActivity, 30_000);
              try {
                return await deps.spawnSubagent({
                  ...task,
                  abortSignal: abortController.signal,
                  parent: {
                    autoApprove: run.autoApprove,
                    conversationId: conversation.id,
                    externalFolderSession:
                      run.externalFolderSession ??
                      conversation.externalFolderSession,
                    fileContextSource: run.fileContextSource,
                    modelId: resolvedModel.modelId,
                    providerId: resolvedModel.providerId,
                    reasoningEffort: conversation.reasoningEffort,
                    rootConversationId: conversation.rootConversationId,
                    selectedFileIds: run.selectedFileIds,
                    selectedMcpServerIds: conversation.selectedMcpServerIds,
                    selectedSkillIds: conversation.selectedSkillIds,
                  },
                });
              } finally {
                clearInterval(heartbeat);
              }
            },
          })
        : null;
    const agentRuntime =
      runtimeSupportsTools && !isPlanMode && !isSubagentRun
        ? createAgentTools({
            onAgentsChange: () => {
              onAgentsChange();
              markActivity();
            },
            onRecord: handleToolExecutionRecord,
            repository: repositories.agentRepository,
          })
        : null;
    const pluginManagementRuntime =
      runtimeSupportsTools && !isPlanMode && !isSubagentRun
        ? createPluginTools({
            onPluginsChange: () => {
              deps.onPluginsChange();
              markActivity();
            },
            onRecord: handleToolExecutionRecord,
            repositories,
          })
        : null;
    const secretRequestRuntime =
      runtimeSupportsTools &&
      !isPlanMode &&
      !isSubagentRun &&
      snapshotRef.current.settings.builtInToolSettings.requestSecret
        ? createSecretRequestTools({
            onRecord: handleToolExecutionRecord,
            repositories,
            requestSecret: (request) => requestRunSecret(request),
          })
        : null;
    // Always available (including plan mode) because honoring an explicit
    // "announce when done" request must never depend on automatic settings.
    const announcementRuntime =
      runtimeSupportsTools && !isSubagentRun
        ? createAnnounceWhenDoneTool({
            onArm: (request) => {
              announcementRequest = request;
            },
            onRecord: handleToolExecutionRecord,
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

    const pluginTools = pluginSnapshot?.tools;
    // MCP and plugin keys are spread after the built-ins, so a same-named tool
    // silently replaces a built-in (e.g. an MCP `listFiles`). Surface that.
    const builtInToolNames = new Set([
      ...Object.keys(builtInRuntimeTools ?? {}),
      ...(announcementRuntime ? Object.keys(announcementRuntime.tools) : []),
    ]);
    for (const source of [mcpRuntime?.tools, pluginTools]) {
      for (const name of Object.keys(source ?? {})) {
        if (builtInToolNames.has(name)) {
          console.warn(
            `[agent-run] tool "${name}" overrides the built-in tool of the same name`,
          );
        }
      }
    }
    const unapprovedRuntimeTools =
      builtInRuntimeTools || mcpRuntime?.tools || todosRuntime || questionRuntime || skillRuntime || scheduleRuntime || taskRuntime || agentRuntime || pluginManagementRuntime || secretRequestRuntime || announcementRuntime || pluginTools
        ? ({
            ...(builtInRuntimeTools ?? {}),
            ...(mcpRuntime?.tools ?? {}),
            ...(todosRuntime?.tools ?? {}),
            ...(questionRuntime?.tools ?? {}),
            ...(skillRuntime?.tools ?? {}),
            ...(scheduleRuntime?.tools ?? {}),
            ...(taskRuntime?.tools ?? {}),
            ...(agentRuntime?.tools ?? {}),
            ...(pluginManagementRuntime?.tools ?? {}),
            ...(secretRequestRuntime?.tools ?? {}),
            ...(announcementRuntime?.tools ?? {}),
            ...(pluginTools ?? {}),
          } satisfies ToolSet)
        : undefined;
    const autoApprovedToolNames = new Set([
      ...WORKSPACE_AUTO_APPROVED_BUILT_IN_TOOL_NAMES,
      ...(todosRuntime ? Object.keys(todosRuntime.tools) : []),
      ...(questionRuntime ? Object.keys(questionRuntime.tools) : []),
      ...(skillRuntime ? ["skill", "skillReadFile"] : []),
      ...(scheduleRuntime ? Object.keys(scheduleRuntime.tools) : []),
      ...(secretRequestRuntime ? Object.keys(secretRequestRuntime.tools) : []),
      ...(announcementRuntime ? [ANNOUNCE_WHEN_DONE_TOOL_NAME] : []),
      ...(isPlanMode && mcpRuntime?.tools
        ? Object.keys(mcpRuntime.tools)
        : []),
      ...(pluginSnapshot?.autoApprovedToolNames ?? []),
    ]);
    const approvedRuntimeTools = unapprovedRuntimeTools
      ? wrapToolsWithApproval(unapprovedRuntimeTools, {
          getRequestSummary: (toolName, toolInput) => {
            const mcpDisplayName = mcpRuntime?.getToolDisplayName(toolName);

            if (mcpDisplayName) {
              return `${mcpDisplayName}: ${summarizeToolInput(toolInput)}`;
            }

            if (
              activeFolderSession &&
              FOLDER_BOUND_TOOL_NAMES.has(toolName)
            ) {
              return buildExternalToolApprovalSummary(
                activeFolderSession,
                toolName,
                toolInput,
              );
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
          mode: run.autoApprove
            ? ("auto" as const)
            : (snapshotRef.current.conversationApprovalModes?.[conversation.id] ?? "ask"),
          onRecord: handleToolExecutionRecord,
          shouldRequireApproval: (toolName) =>
            !autoApprovedToolNames.has(toolName) &&
            !snapshotRef.current.conversationApprovedTools?.[
              conversation.id
            ]?.includes(toolName),
          requestApproval: (request) =>
            requestRunApproval(request as PendingToolApprovalRequest),
        })
      : undefined;
    const runtimeToolsBase =
      approvedRuntimeTools || memoryRuntime?.tools
        ? ({
            ...(approvedRuntimeTools ?? {}),
            ...(memoryRuntime?.tools ?? {}),
          } satisfies ToolSet)
        : undefined;
    const runtimeTools = isSubagentRun && runtimeToolsBase
      ? (Object.fromEntries(
          Object.entries(runtimeToolsBase).filter(
            ([name]) => !SUBAGENT_DEFAULT_DENIED_TOOL_NAMES.has(name),
          ),
        ) as ToolSet)
      : runtimeToolsBase;
    const builtInRuntimeSystem =
      run.fileContextSource === "external-folder" && builtInRuntimeTools
        ? buildExternalFolderSystemPrompt(
            externalFolderSession as ExternalFolderSession,
          )
        : undefined;
    const workspaceRuntimeSystem =
      run.fileContextSource !== "external-folder" &&
      builtInRuntimeTools &&
      ("createFile" in builtInRuntimeTools || "write" in builtInRuntimeTools)
        ? buildWorkspaceSystemPrompt()
        : undefined;
    const transferRuntimeSystem =
      builtInRuntimeTools &&
      ("exportWorkspaceFileToFolder" in builtInRuntimeTools ||
        "importFolderFileToWorkspace" in builtInRuntimeTools)
        ? buildTransferSystemPrompt(activeFolderSession as ExternalFolderSession)
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
    const skillsForPrompt = snapshotRef.current.skills.filter(
      (skill) => skill.enabled,
    );
    const skillsRuntimeSystem = buildSkillsSystemPrompt({
      loadedSkillNames: loadedSkillNames(persistedMessages),
      builtInToolSettings: snapshotRef.current.settings.builtInToolSettings,
      mcpServers: runMcpServers,
      skills: skillsForPrompt,
    });
    const skillManagementRuntimeSystem =
      skillRuntime && runtimeSupportsTools && !isPlanMode
        ? "You can create, update, delete, and list skills with the manageSkill tool. Skills follow the SKILL.md format: a name, a short description, and markdown instructions. Create a skill when the user explicitly asks to save one, or when a repeated task would benefit from reusable instructions. A skill may include supporting files (scripts, references, templates) which are listed when you load it with the skill tool; use the skillReadFile tool to read the full contents of one of those files when needed."
        : undefined;
    const pluginManagementRuntimeSystem =
      pluginManagementRuntime && runtimeSupportsTools && !isPlanMode
        ? "You can create, update, delete, and list plugins with the managePlugin tool. Plugins are reusable capabilities that add tools and optional system-prompt instructions to any conversation. Use createPlugin when the user asks for a new reusable capability (e.g. checking weather, querying an API, syncing services). You provide a kebab-case name, a short description, and one or more tool definitions — each with a name, a JSON Schema inputSchema, and a self-contained JavaScript executeBody. Inside the executeBody, `args` is the tool input; `api.fetch(url, init)`, `api.storage.get/set/delete(key)`, `api.secrets.get/set/delete(key)`, and `api.log(...)` are available. Do NOT use imports or require() inside executeBody — the plugin sandbox has no module system. Set mutating: true for any tool that writes, sends, or deletes data so the user is asked to approve it before running. You can also add optional system lines that are injected as extra prompt instructions whenever the plugin is active.\n\nSecrets policy: if a plugin tool needs an API key or token, reference it only by key name inside the executeBody (e.g. `await api.secrets.get(\"WUNDERLIST_API_KEY\")`). NEVER ask the user to type a secret value into the chat and NEVER repeat a stored value back — doing so exposes it in the conversation. Instead, tell the user to enter it in Settings → Plugins → the plugin → Secrets. After createPlugin/updatePlugin, list the returned secretsMissing keys so the user knows exactly what to configure. To collect a missing secret in-chat, call the requestSecret tool with the plugin id (from listPlugins) and the exact key name; the user types the value into a masked, encrypted on-device prompt that you never see — you only learn whether it was stored or deferred. If the user defers, continue without it and let them know the key is still missing; do not keep asking. You cannot read secret values; you can only see which key names are configured."
        : undefined;
    const agentManagementRuntimeSystem =
      agentRuntime && runtimeSupportsTools && !isPlanMode
        ? "You can create, update, delete, and list agents with the manageAgent tool. Agents are reusable personas: a kebab-case name, a description of when to use them, an availability mode (primary = selectable in chats, subagent = invoked via the task tool, all = both), and a markdown system prompt that replaces your default persona while they run. Create an agent when the user explicitly asks to save one."
        : undefined;
    const memoryRuntimeSystem = snapshotRef.current.settings.memoryEnabled
      ? buildMemorySystemPrompt(snapshotRef.current.memory, {
          canWrite: runtimeSupportsTools && !isPlanMode && !isSubagentRun,
        })
      : undefined;
    const subagentRuntimeSystem = isSubagentRun
      ? [
          `You are the "${agent.name}" subagent, spawned by the primary agent to complete a delegated task.`,
          agent.description ? `Your specialty: ${agent.description}.` : undefined,
          "Work only on the delegated task. When you finish, report your findings or results as the final response; the primary agent will use them.",
          "You cannot spawn further subagents, schedule jobs, or modify persistent memory.",
        ]
          .filter(Boolean)
          .join("\n")
      : undefined;
    const taskRuntimeSystem = taskRuntime && runtimeSupportsTools && !isPlanMode
      ? `You can delegate work with the task tool.\n\n${describeSubagentCatalog(snapshotRef.current.agents)}\n\nDelegate when a subagent's specialty fits part of the work or for isolated multi-step research. Write self-contained prompts; the subagent cannot see this conversation. Wait for its result before continuing dependent work.`
      : undefined;
    const announcementRuntimeSystem = announcementRuntime
      ? [
          "If the user explicitly asks to be told, notified, announced, or pinged when the task is done (for example, \"let me know when you're done\" or \"announce when finished\"), call the announceWhenDone tool as soon as you understand the request.",
          "Pass a short message only when the user asks you to say a specific phrase; otherwise omit it.",
          "Never call announceWhenDone unless the user explicitly asked for a notification. It ignores the app's automatic announcement settings, so do not use it for routine progress updates.",
        ].join("\n")
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
    const agentDocsRuntimeSystem =
      agent.docs.length > 0
        ? [
            "The following are attached reference documents for this agent. Use them as authoritative context, quoting and following them when relevant to the task.",
            ...agent.docs.map(
              (doc) =>
                `--- Document: ${doc.name} ---\n${doc.content}\n--- End document ---`,
            ),
          ].join("\n\n")
        : undefined;
    const pluginSystemParts = pluginSnapshot?.systemParts;
    const runtimeSystem =
      [
        agent.prompt?.trim() || BASE_AGENT_SYSTEM_PROMPT,
        agentDocsRuntimeSystem,
        subagentRuntimeSystem,
        buildCurrentDateTimeSystemPrompt(),
        builtInRuntimeSystem,
        workspaceRuntimeSystem,
        transferRuntimeSystem,
        mcpRuntime?.systemPrompt,
        memoryRuntimeSystem,
        skillsRuntimeSystem,
        skillManagementRuntimeSystem,
        pluginManagementRuntimeSystem,
        agentManagementRuntimeSystem,
        taskRuntimeSystem,
        announcementRuntimeSystem,
        toolLoopRuntimeSystem,
        ...(pluginSystemParts?.length ? pluginSystemParts : []),
      ]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n") || undefined;

    if (
      resolvedModel.providerFamily === "on-device" &&
      resolvedModel.supportsTools &&
      onDevicePolicy.memoryConstrained &&
      !runtimeSupportsTools
    ) {
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail:
            "Tools were turned off for this run to reduce memory use. You can enable them manually in the on-device model settings.",
          kind: "run",
          status: "info",
          title: "Tools off (memory safe)",
          createdAt: new Date().toISOString(),
        }),
      );
    }

    let contextWindowFromCatalog: number | null = null;
    try {
      const catalog = await fetchModelsDevCatalogCached();
      contextWindowFromCatalog =
        findModelsDevModel(
          catalog,
          resolvedModel.providerId,
          resolvedModel.modelId,
        )?.contextWindow ?? null;
    } catch {}

    if (resolvedModel.contextWindow !== null) {
      contextWindowFromCatalog = resolvedModel.contextWindow;
    }

    if (
      resolvedModel.providerFamily === "ollama"
    ) {
      const ollamaOptions = resolvedModel.options?.ollama;
      if (
        ollamaOptions &&
        typeof ollamaOptions === "object" &&
        "contextWindow" in ollamaOptions
      ) {
        const ctx = (ollamaOptions as { contextWindow?: unknown })
          .contextWindow;
        if (typeof ctx === "number" && ctx > 0) {
          contextWindowFromCatalog = ctx;
        }
      }
    }

    if (
      contextWindowFromCatalog === null &&
      resolvedModel.providerFamily === "on-device"
    ) {
      const onDeviceOptions = resolvedModel.options?.onDevice;
      if (
        onDeviceOptions &&
        typeof onDeviceOptions === "object" &&
        "contextWindow" in onDeviceOptions
      ) {
        const contextWindow = (onDeviceOptions as { contextWindow?: unknown })
          .contextWindow;
        if (typeof contextWindow === "number" && contextWindow > 0) {
          contextWindowFromCatalog = contextWindow;
        }
      }
    }

    if (
      resolvedModel.providerFamily === "on-device" &&
      onDevicePolicy.contextWindow !== null
    ) {
      contextWindowFromCatalog = onDevicePolicy.contextWindow;
    }

    let summaryUsage: LanguageModelUsage | undefined;
    let compactedSummary: string | undefined;
    const generateContextSummary: GenerateSummary = async (prompt) => {
      const result = await modelRuntime.generateTextStream({
        abortSignal: abortController.signal,
        maxToolSteps: 1,
        messages: [{ role: "user", content: prompt }],
        model: resolvedModel,
        provider,
        secretStore: secureSecretStore,
        onEvent: () => markActivity(),
        onDelta: () => markActivity(),
      });
      summaryUsage = combineUsage(summaryUsage, result.usage);
      return result.text;
    };
    const generateSummary: GenerateSummary | undefined =
      resolvedModel.providerFamily === "on-device"
        ? undefined
        : generateContextSummary;

    const prepareRuntimeMessages = async (messages: ModelMessage[]) => {
      const contextResult = await prepareMessagesForLLMWithSummary({
        contextWindow: contextWindowFromCatalog,
        messages,
        model: resolvedModel,
        systemPrompt: runtimeSystem,
        tools: runtimeTools,
        generateSummary,
      });
      if (
        resolvedModel.providerFamily === "on-device" &&
        runtimeTools &&
        contextResult.budget.usable === 0
      ) {
        throw new Error(
          "Enabled tools exceed this device safe context limit. Disable some tools or MCP servers, or switch the model back to Auto.",
        );
      }

      if (isOverflow(contextResult.messages, contextResult.budget)) {
        throw new Error(
          "The latest messages or tool results still exceed the context budget after compaction. Use smaller inputs, disable some tools, or select a model with a larger context window.",
        );
      }

      if (
        contextResult.didPrune ||
        contextResult.didTruncate ||
        contextResult.didSummarize
      ) {
        const actions = [
          contextResult.didPrune ? "pruned tool outputs" : null,
          contextResult.didSummarize ? "summarized older messages" : null,
          contextResult.didTruncate ? "truncated old messages" : null,
        ].filter((action): action is string => action !== null);
        contextCompactions.push({
          trigger: "automatic",
          createdAt: new Date().toISOString(),
          beforeTokens: estimateMessagesTokens(messages),
          afterTokens: estimateMessagesTokens(contextResult.messages),
          inputBudget: contextResult.budget.usable,
          didPrune: contextResult.didPrune,
          didTruncate: contextResult.didTruncate,
          summary: contextResult.summaryText ?? null,
        });
        pushTimelineEvent(
          createExecutionTimelineEvent({
            detail: `Context managed: ${actions.join(" + ")} (${contextResult.budget.usable} token budget)`,
            kind: "run",
            status: "info",
            title: "Context managed",
            createdAt: new Date().toISOString(),
          }),
        );
      }
      return contextResult.messages;
    };

    if (!manualCompaction) runtimeMessages = await prepareRuntimeMessages(runtimeMessages);

    const breakdownBudget = calculateContextBudget({
      contextWindow: contextWindowFromCatalog,
      model: resolvedModel,
      systemPrompt: runtimeSystem,
      tools: runtimeTools,
    });
    const claimedToolNames = new Set<string>();
    const claimToolNames = (source: ToolSet | undefined) => {
      const names: string[] = [];
      for (const name of Object.keys(source ?? {})) {
        if (
          !runtimeTools ||
          !(name in runtimeTools) ||
          claimedToolNames.has(name)
        ) {
          continue;
        }
        claimedToolNames.add(name);
        names.push(name);
      }
      return names;
    };
    // Claim in reverse spread order so a tool that replaced a built-in is
    // attributed to the source that effectively supplied it.
    const memoryToolNames = claimToolNames(memoryRuntime?.tools);
    const pluginToolNames = claimToolNames(pluginTools);
    const announcementToolNames = claimToolNames(announcementRuntime?.tools);
    const secretToolNames = claimToolNames(secretRequestRuntime?.tools);
    const pluginManagementToolNames = claimToolNames(
      pluginManagementRuntime?.tools,
    );
    const agentToolNames = claimToolNames(agentRuntime?.tools);
    const taskToolNames = claimToolNames(taskRuntime?.tools);
    const scheduleToolNames = claimToolNames(scheduleRuntime?.tools);
    const skillToolNames = claimToolNames(skillRuntime?.tools);
    const questionToolNames = claimToolNames(questionRuntime?.tools);
    const todosToolNames = claimToolNames(todosRuntime?.tools);
    const breakdownMcpToolNames = claimToolNames(mcpRuntime?.tools);
    const breakdownBuiltInToolNames = claimToolNames(builtInRuntimeTools);
    const breakdownSources: ContextBreakdownSource[] = [
      {
        key: "system",
        label: "System prompt",
        text: [
          agent.prompt?.trim() || BASE_AGENT_SYSTEM_PROMPT,
          agentDocsRuntimeSystem,
          subagentRuntimeSystem,
          buildCurrentDateTimeSystemPrompt(),
          builtInRuntimeSystem,
          workspaceRuntimeSystem,
          transferRuntimeSystem,
          skillManagementRuntimeSystem,
          pluginManagementRuntimeSystem,
          agentManagementRuntimeSystem,
          taskRuntimeSystem,
          announcementRuntimeSystem,
          toolLoopRuntimeSystem,
        ]
          .filter((part): part is string => Boolean(part?.trim()))
          .join("\n\n"),
      },
      { key: "memory", label: "Memory", text: memoryRuntimeSystem },
      { key: "skills", label: "Skills", text: skillsRuntimeSystem },
      { key: "mcp", label: "MCP", text: mcpRuntime?.systemPrompt },
      {
        key: "plugins",
        label: "Plugins",
        text: pluginSystemParts?.join("\n\n"),
      },
      {
        key: "tools",
        label: "Built-in tools",
        toolNames: breakdownBuiltInToolNames,
        tools: runtimeTools,
      },
      {
        key: "tool-management",
        label: "Agent runtime tools",
        toolNames: [
          ...todosToolNames,
          ...questionToolNames,
          ...scheduleToolNames,
          ...taskToolNames,
          ...agentToolNames,
          ...pluginManagementToolNames,
          ...secretToolNames,
          ...announcementToolNames,
        ],
        tools: runtimeTools,
      },
      {
        key: "mcp",
        label: "MCP",
        toolNames: breakdownMcpToolNames,
        tools: runtimeTools,
      },
      {
        key: "skills",
        label: "Skills",
        toolNames: skillToolNames,
        tools: runtimeTools,
      },
      {
        key: "memory",
        label: "Memory",
        toolNames: memoryToolNames,
        tools: runtimeTools,
      },
      {
        key: "plugins",
        label: "Plugins",
        toolNames: pluginToolNames,
        tools: runtimeTools,
      },
    ];
    const contextBreakdown = manualCompaction
      ? undefined
      : buildContextBreakdown({
          contextWindow: breakdownBudget.contextWindow,
          messages: runtimeMessages,
          reserved: breakdownBudget.reserved,
          sources: breakdownSources,
        });

    pushTimelineEvent(
      createExecutionTimelineEvent({
        detail: `${resolvedModel.providerLabel} · ${resolvedModel.label}`,
        kind: "run",
        status: "info",
        title: "Run started",
        createdAt: resumedRun?.startedAt ?? run.startedAt,
      }),
    );

    // Steer inbox for this run. Promoted at the next safe step boundary by
    // the driver's prepareStep; queued items are never drained here — they
    // only start a new turn once this run is idle.
    let steerStepBudgetBase = 0;
    const takeSteeredUserInput = async (
      stepNumber: number,
    ): Promise<ModelMessage[]> => {
      if (runRegistry.isDisposed() || abortController.signal.aborted) {
        return [];
      }

      let pending: PendingInput[];
      try {
        pending = await repositories.pendingInputRepository.listByConversation(
          conversation.id,
        );
      } catch (pendingError) {
        console.warn("Failed to read pending steers.", pendingError);
        return [];
      }

      const steers = pending.filter((item) => item.delivery === "steer");
      if (steers.length === 0) {
        return [];
      }

      const steerIds = new Set(steers.map((steer) => steer.id));
      for (const steer of steers) {
        try {
          await repositories.pendingInputRepository.delete(steer.id);
        } catch (deleteError) {
          console.warn("Failed to consume pending steer.", deleteError);
        }
      }

      // Fresh step budget so the run can act on the correction even when it
      // is close to maxToolSteps (opencode resets its step allowance on
      // steer promotion; a batch of steers resets it once).
      steerStepBudgetBase = stepNumber;

      ui.publishSnapshot((current) => ({
        ...current,
        pendingInputs: current.pendingInputs.filter(
          (item) => !steerIds.has(item.id),
        ),
      }));

      // Split the assistant's row at the delivery point: text streamed so
      // far is finalized on the current row, the steer entries land next,
      // and a fresh continuation row receives everything after — so the
      // steer renders mid-response instead of after the full reply.
      const preSplitText = assistantText;
      const rowToSplit = activeAssistantMessage;
      // Deep copy: buildAssistantMetadata hands back the live closure
      // arrays by reference, and those are reset below for the
      // continuation row.
      const liveSplitMetadata = buildLiveAssistantMetadata();
      const splitMetadata = liveSplitMetadata
        ? (JSON.parse(JSON.stringify(liveSplitMetadata)) as MessageMetadata)
        : null;
      if (preSplitText.trim()) {
        try {
          await repositories.messageRepository.updateContent({
            content: preSplitText,
            error: null,
            id: rowToSplit.id,
            metadata: splitMetadata,
            status: "completed",
          });
        } catch (splitError) {
          console.warn(
            "Failed to finalize the pre-steer assistant segment.",
            splitError,
          );
        }
      } else {
        // Nothing streamed yet: drop the empty row instead of rendering an
        // empty bubble ahead of the steer. Activity metadata lives in this
        // run's closures and is written to the continuation row, so no
        // durable record is lost.
        try {
          await repositories.messageRepository.delete(rowToSplit.id);
        } catch (deleteError) {
          console.warn(
            "Failed to remove the empty pre-steer assistant segment.",
            deleteError,
          );
        }
      }

      const deliveredMessages: StoredMessage[] = [];
      for (const steer of steers) {
        try {
          deliveredMessages.push(
            await repositories.messageRepository.create({
              conversationId: conversation.id,
              content: steer.content,
              metadata: {
                ...(steer.metadata ?? {}),
                steeredIntoRunId: run.id,
              },
              role: "user",
              sequence: await repositories.messageRepository.getNextSequence(
                conversation.id,
              ),
              status: "completed",
            }),
          );
        } catch (persistError) {
          console.warn("Failed to persist delivered steer.", persistError);
        }
      }

      // Fresh continuation row for the post-steer text. The run record
      // follows it so resume/recovery and the final flush land there too.
      let continuationRow: StoredMessage | null = null;
      try {
        continuationRow = await repositories.messageRepository.create({
          conversationId: conversation.id,
          content: "",
          role: "assistant",
          sequence: await repositories.messageRepository.getNextSequence(
            conversation.id,
          ),
          status: "streaming",
        });
        activeAssistantMessage = continuationRow;
        run.assistantMessageId = continuationRow.id;
        await safeUpdateRunRecord(run.id, {
          assistantMessageId: continuationRow.id,
        });
      } catch (continuationError) {
        console.warn(
          "Failed to start a post-steer assistant segment.",
          continuationError,
        );
      }

      // Pending debounced writes for the old row are dropped so they cannot
      // land on the new one, text-anchored activity metadata restarts with
      // the continuation row (its frozen copy stays on the previous row),
      // and the active-row accumulator starts empty at this split point.
      if (persistTimeout) {
        clearTimeout(persistTimeout);
        persistTimeout = null;
      }
      if (snapshotTimer) {
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }
      pendingSnapshotStatus = null;
      pendingSnapshotError = null;
      if (continuationRow) {
        if (preSplitText.trim()) contextCompactions.length = 0;
        toolExecutions.length = 0;
        toolRunAnchors.clear();
        reasoning.length = 0;
        activeReasoning.clear();
        executionTimeline.length = 0;
        memoryEvents.length = 0;
        promptArtifacts.length = 0;
        todoList.length = 0;
        assistantSplitCharOffset += preSplitText.length;
        assistantText = "";
      }

      if (deliveredMessages.length > 0 || continuationRow) {
        const preSplitSegment: StoredMessage | null = preSplitText.trim()
          ? {
              ...rowToSplit,
              content: preSplitText,
              error: null,
              metadata: splitMetadata,
              status: "completed",
              updatedAt: new Date().toISOString(),
            }
          : null;
        ui.publishSnapshot((current) => {
          if (current.currentConversation?.id !== conversation.id) {
            return current;
          }
          // An empty pre-split row was deleted above; a populated one is
          // replaced by its finalized segment.
          const baseMessages = preSplitText.trim()
            ? current.messages
            : current.messages.filter((item) => item.id !== rowToSplit.id);
          return {
            ...current,
            messages: upsertMessages(baseMessages, [
              ...deliveredMessages,
              ...(preSplitSegment ? [preSplitSegment] : []),
              ...(continuationRow ? [continuationRow] : []),
            ]),
          };
        });
        if (deliveredMessages.length > 0) {
          pushTimelineEvent(
            createExecutionTimelineEvent({
              detail:
                deliveredMessages.length === 1
                  ? "Delivered mid-run guidance into the active turn."
                  : `Delivered ${deliveredMessages.length} steered prompts into the active turn.`,
              kind: "run",
              status: "info",
              title: "Steer delivered",
              createdAt: new Date().toISOString(),
            }),
          );
        }
      }

      // If transcript persistence failed, still hand the steers to the
      // model — the rows are already consumed, and losing the user's
      // guidance would be worse than missing a transcript row.
      return (deliveredMessages.length > 0
        ? deliveredMessages.map((message) => message.content)
        : steers.map((steer) => steer.content)
      ).map((content) => ({
        role: "user" as const,
        content: formatSteeredUserContent(content),
      }));
    };

    const runtimeResultPromise: Promise<GenerateModelTextStreamResult> = manualCompaction
      ? (async () => {
          const budget = calculateContextBudget({ model: resolvedModel, contextWindow: contextWindowFromCatalog });
          compactedSummary = await compactHistory({
            messages: runtimeMessages,
            inputBudget: budget.usable,
            generateSummary: generateContextSummary,
          });
          contextCompactions.push({
            trigger: "manual",
            createdAt: new Date().toISOString(),
            beforeTokens: estimateMessagesTokens(runtimeMessages),
            afterTokens: estimateMessagesTokens([createSummaryMessage(compactedSummary)]),
            inputBudget: budget.usable,
            didPrune: false,
            didTruncate: false,
            summary: compactedSummary,
          });
          return { text: "Conversation compacted. Earlier messages remain visible; future replies will use the summary." };
        })()
      : modelRuntime.generateTextStream({
      abortSignal: abortController.signal,
      prepareMessages: prepareRuntimeMessages,
      getStepBudgetBase: () => steerStepBudgetBase,
      maxToolSteps: 9999,
      messages: runtimeMessages,
      model: resolvedModel,
      ...(agent.temperature !== null && agent.temperature !== undefined
        ? { temperature: agent.temperature }
        : {}),
      onDelta: (delta) => {
        if (runRegistry.isDisposed()) return;
        markActivity();
        assistantText += delta;
        void pluginSnapshot?.dispatch("message:delta", {
          conversationId: run.conversationId,
          delta,
          runId: run.id,
        })?.catch(() => {});
        schedulePersist("streaming");
        scheduleSnapshot("streaming");
      },
      onEvent: (eventName, data) => {
        if (runRegistry.isDisposed()) return;
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

        updateReasoningPhase(reasoning, activeReasoning, {
          id, kind: eventName, text: event?.text, textOffset: assistantText.length,
        }, () => traceOrder++);

        refreshAssistantState?.();
      },
      provider,
      reasoning:
        resolvedModel.supportsReasoning ||
        (provider.family === "openai-compatible" &&
          resolvedModel.transport === "openaiCompatible")
          ? conversation.reasoningEffort
          : undefined,
      secretStore: secureSecretStore,
      sessionId: run.id,
      system: runtimeSystem,
      takeSteeredUserInput,
      tools: runtimeTools,
    });
    // Attach an early handler so React Native doesn't report the abort
    // rejection as unhandled in the window before we await it below.
    void runtimeResultPromise.catch(() => {});

    const persistArtifacts = (async () => {
      try {
        const modelArtifactInput = buildModelPromptArtifact({
          messages: runtimeMessages,
          model: resolvedModel,
          run,
          system: runtimeSystem,
        });
        const modelPromptFile = await workspaceService.createManagedTextFile({
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
          const toolPromptFile = await workspaceService.createManagedTextFile({
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
    })();
    void persistArtifacts.catch(() => {});

    const runtimeResult = await runtimeResultPromise;
    // A tool failure after an abort (e.g. a preview cancelled by the
    // inactivity timeout) resolves the stream with stale text instead of
    // rejecting. Never record that as a successful run.
    if (abortController.signal.aborted) {
      throw new Error(
        requestTimedOut
          ? "Request timed out. Please try again."
          : "Generation stopped.",
      );
    }
    await persistArtifacts;

    await Promise.allSettled(pendingArtifactWrites);

    // A steer split already finalized the pre-split text on its own row;
    // the merged driver text spans every segment, so this row owns only
    // the post-split tail.
    assistantText =
      runtimeResult.text.slice(assistantSplitCharOffset) || assistantText;
    const generatedImages = await persistGeneratedImages(
      runtimeResult.generatedFiles ?? [],
    );
    const generatedVideos = collectGeneratedVideos(runtimeResult.toolResults);

    if (
      !assistantText.trim() &&
      (generatedImages.length > 0 || generatedVideos.length > 0)
    ) {
      assistantText =
        generatedVideos.length > 0 ? "Rendered a video." : "Generated an image.";
    }

    if (!assistantText.trim()) {
      assistantText = runtimeResult.stepLimitReached
        ? "Stopped after reaching the tool-step safety limit. Ask me to continue."
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

    if (generatedVideos.length > 0) {
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail: `${generatedVideos.length} video${
            generatedVideos.length === 1 ? "" : "s"
          }`,
          kind: "image",
          status: "completed",
          title: "Rendered video output",
        }),
      );
    }

    const assistantUsage = buildUsageSnapshot({
      contextWindow: contextWindowFromCatalog,
      contextUsage: runtimeResult.contextUsage,
      model: resolvedModel,
      usage: combineUsage(runtimeResult.usage, summaryUsage),
    });
    if (compactedSummary) {
      const budget = calculateContextBudget({
        contextWindow: contextWindowFromCatalog,
        model: resolvedModel,
        systemPrompt: runtimeSystem,
        tools: runtimeTools,
      });
      assistantUsage.contextTokens = estimateMessagesTokens([createSummaryMessage(compactedSummary)]) +
        budget.systemTokens + budget.toolDefinitionTokens;
      assistantUsage.contextIsEstimated = true;
    }
    const assistantMetadata = buildAssistantMetadata({
      contextBreakdown,
      contextCompactions,
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
      generatedVideos,
      memoryEvents,
      promptArtifacts,
      pluginOutputs: pluginSnapshot?.pluginOutputs,
      reasoning: reasoning.map((block) => ({
        ...block,
        completedAt: block.completedAt ?? new Date().toISOString(),
      })),
      runId: run.id,
      toolRunAnchors: Array.from(
        toolRunAnchors,
        ([executionId, textOffset]) => ({ executionId, textOffset }),
      ),
      todoList,
      toolExecutions,
      usage: assistantUsage,
    });
    if (compactedSummary && assistantMetadata && userMessage) {
      assistantMetadata.contextCompaction = {
        summary: compactedSummary,
        throughSequence: userMessage.sequence,
      };
    }

    await flushPersist("completed", null, assistantMetadata);
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
    });

    await pluginSnapshot?.dispatch("run:complete", {
      conversationId: run.conversationId,
      runId: run.id,
    });

    const [memory, workspaceFiles] = await Promise.all([
      repositories.memoryStore.read(),
      repositories.workspaceRepository.list(),
    ]);

    ui.publishSnapshot(
      (current) => ({
        ...current,
        messages:
          current.currentConversation?.id === conversation.id
            ? upsertMessages(current.messages, [
                {
                  ...activeAssistantMessage,
                  content: assistantText,
                  error: null,
                  metadata: assistantMetadata,
                  status: "completed",
                },
              ])
            : current.messages,
        memory,
        workspaceFiles,
      }),
      { force: true },
    );

    if (conversation.title === "New chat") {
      void generateAndApplyConversationTitle({
        conversation,
        firstUserMessage: run.input,
        model: resolvedModel,
        provider,
        runId: run.id,
      }).catch((error) => {
        if (isUiProjectionFailure(error)) {
          reportProjectionFailure("conversation-title", error);
        }
      });
    }

    const announcement = resolveAnnouncementRequest();

    await notifyRunStateChange({
      announcement,
      body: announcement?.message ?? "Agent finished this task.",
      conversationId: conversation.id,
      status: "success",
      title: conversation.title,
    }).catch(() => {});
  } catch (sendError) {
    // The provider owns this DB connection. After teardown it may already
    // be closed; even trying to save a failure would throw again. Startup
    // recovery handles the interrupted streaming row on the next mount.
    if (runRegistry.isDisposed()) return;
    const requestAbortedEarly = abortController.signal.aborted;
    const isUserCancel = requestAbortedEarly && !requestTimedOut;
    if (!isUserCancel) {
      const serializedError =
        sendError instanceof Error
          ? {
              message: sendError.message,
              name: sendError.name,
              stack: sendError.stack,
            }
          : { raw: sendError };
      console.error("[agent-run] executeClaimedAgentRun caught", {
        runId: run.id,
        providerId: run.providerId,
        modelId: run.modelId,
        requestAborted: requestAbortedEarly,
        error: serializedError,
      });
    }
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

    const retryClassification = requestAborted
      ? { retryable: false, category: "permanent" as const }
      : classifyRetryableError(sendError);

    const currentRetryCount = run.retryCount ?? 0;
    const maxRetries = run.maxRetries ?? 3;

    if (
      retryClassification.retryable &&
      currentRetryCount < maxRetries &&
      finalStatus !== "canceled"
    ) {
      const nextRetryCount = currentRetryCount + 1;
      const delayMs = getRetryDelayMs(
        currentRetryCount,
        retryClassification.category,
      );

      await safeUpdateRunRecord(run.id, {
        completedAt: null,
        lastError: errorMessage,
        status: "retrying",
        retryCount: nextRetryCount,
        lastRetryAt: new Date().toISOString(),
      });

      const retryMeta = buildAssistantMetadata({
        executionTimeline: [
          ...executionTimeline,
          createExecutionTimelineEvent({
            detail: `Attempt ${nextRetryCount}/${maxRetries} failed: ${errorMessage}. Retrying in ${Math.round(delayMs / 1000)}s...`,
            kind: "run",
            status: "info",
            title: `Retrying (${nextRetryCount}/${maxRetries})`,
          }),
        ],
        memoryEvents,
        promptArtifacts,
        pluginOutputs: pluginSnapshot?.pluginOutputs,
        reasoning: reasoning.map((block) => ({
          ...block,
          completedAt: block.completedAt ?? new Date().toISOString(),
        })),
        runId: run.id,
        toolRunAnchors: Array.from(
          toolRunAnchors,
          ([executionId, textOffset]) => ({ executionId, textOffset }),
        ),
        todoList,
        toolExecutions,
      });

      await flushPersist("streaming", null, retryMeta);

      ui.publishSnapshot(
        (current) => ({
          ...current,
          agentRuns: upsertAgentRun(current.agentRuns, {
            ...run,
            lastError: errorMessage,
            retryCount: nextRetryCount,
            status: "retrying",
          }),
          messages:
            current.currentConversation?.id === conversation.id
              ? upsertMessages(current.messages, [
                  {
                    ...activeAssistantMessage,
                    content:
                      assistantText ||
                      `Retrying (${nextRetryCount}/${maxRetries})...`,
                    error: null,
                    metadata: retryMeta,
                    status: "streaming",
                  },
                ])
              : current.messages,
        }),
        { force: true },
      );

      retryRun(run.id, delayMs);

      return;
    }

    if (!assistantText) {
      assistantText = requestAborted
        ? requestTimedOut
          ? "This response took too long and was stopped. Try again."
          : "Stopped."
        : `Something went wrong: ${errorMessage}`;
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
      pluginOutputs: pluginSnapshot?.pluginOutputs,
      reasoning: reasoning.map((block) => ({
        ...block,
        completedAt: block.completedAt ?? new Date().toISOString(),
      })),
      runId: run.id,
      toolRunAnchors: Array.from(
        toolRunAnchors,
        ([executionId, textOffset]) => ({ executionId, textOffset }),
      ),
      todoList,
      toolExecutions,
    });

    await flushPersist(
      "failed",
      finalStatus === "canceled" ? null : errorMessage,
      assistantMetadata,
    );
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: finalStatus === "canceled" ? null : errorMessage,
      status: finalStatus,
    });

    if (finalStatus === "failed") {
      await pluginSnapshot?.dispatch("run:failed", {
        conversationId: run.conversationId,
        error: errorMessage,
        runId: run.id,
      });
    }

    if (
      finalStatus === "failed" &&
      snapshotRef.current.currentConversation?.id === conversation.id
    ) {
      ui.publishError(errorMessage);
    }

    const [memory, workspaceFiles] = await Promise.all([
      repositories.memoryStore.read(),
      repositories.workspaceRepository.list(),
    ]);

    ui.publishSnapshot(
      (current) => ({
        ...current,
        messages:
          current.currentConversation?.id === conversation.id
            ? upsertMessages(current.messages, [
                {
                  ...activeAssistantMessage,
                  content: assistantText,
                  error: finalStatus === "canceled" ? null : errorMessage,
                  metadata: assistantMetadata,
                  status: "failed",
                },
              ])
            : current.messages,
        memory,
        workspaceFiles,
      }),
      { force: true },
    );

    if (finalStatus === "failed") {
      await notifyRunStateChange({
        announcement: resolveAnnouncementRequest(),
        body: errorMessage,
        conversationId: conversation.id,
        status: "failed",
        title: conversation.title,
      }).catch(() => {});
    }
  } finally {
    if (persistTimeout) clearTimeout(persistTimeout);
    if (snapshotTimer) clearTimeout(snapshotTimer);
    dismissApprovalNotification(run.id).catch(() => {});
    dismissQuestionNotification(run.id).catch(() => {});
    dismissSecretNotification(run.id).catch(() => {});

    if (shouldKeepBackgroundAgentAlive()) {
      startBackgroundAgent();
    } else {
      stopBackgroundAgent();
    }

    await mcpRuntime?.close();

    if (inactivityTimeout) {
      clearTimeout(inactivityTimeout);
    }

    runRegistry.clear(run.id);
    ui.publishApprovals((current) =>
      current.filter((approval) => approval.runId !== run.id),
    );
  }
}

const SUBAGENT_NOOP_UI: RunUiPublisher = {
  publishApprovals: () => {},
  publishError: () => {},
  publishSnapshot: () => {},
};

export type SubagentParentContext = {
  autoApprove: boolean;
  conversationId: string;
  externalFolderSession: ExternalFolderSession | null;
  fileContextSource: FileContextSource | null;
  modelId: string;
  providerId: string;
  reasoningEffort: ReasoningEffort;
  rootConversationId: string | null;
  selectedFileIds: string[];
  selectedMcpServerIds: string[] | null;
  selectedSkillIds: string[];
};

export type SubagentTaskInput = {
  abortSignal?: AbortSignal;
  agentName: string;
  description: string;
  /** Chat context the delegated task inherits from its parent run. */
  parent?: SubagentParentContext;
  prompt: string;
};

export async function executeSubagentTask(
  parentDeps: AgentRunDeps,
  input: SubagentTaskInput,
): Promise<SubagentTaskResult> {
  const {
    repositories,
    snapshotRef,
    runRegistry,
    shouldKeepBackgroundAgentAlive,
    refreshScheduler,
  } = parentDeps;

  const snapshot = snapshotRef.current;
  const agent = listSubagents(snapshot.agents).find(
    (candidate) =>
      candidate.name === input.agentName || candidate.id === input.agentName,
  );

  if (!agent) {
    throw new Error(`"${input.agentName}" is not available as a subagent.`);
  }

  const agentModel =
    agent.modelProviderId && agent.modelModelId
      ? snapshot.resolvedConfig.availableModels.find(
          (model) =>
            model.providerId === agent.modelProviderId &&
            model.modelId === agent.modelModelId,
        )
      : null;

  if (
    agent.modelProviderId &&
    agent.modelModelId &&
    !agentModel
  ) {
    throw new Error(
      `Subagent "${agent.name}" is configured to use ${agent.modelProviderId}/${agent.modelModelId}, which is unavailable. Enable that provider or pick a different model for the agent.`,
    );
  }

  const parent = input.parent;
  const modelRef = agentModel
    ? {
        modelId: agentModel.modelId,
        providerId: agentModel.providerId,
      }
    : parent
      ? { modelId: parent.modelId, providerId: parent.providerId }
      : snapshot.resolvedConfig.currentModel
        ? {
            modelId: snapshot.resolvedConfig.currentModel.modelId,
            providerId: snapshot.resolvedConfig.currentModel.providerId,
          }
        : null;

  if (!modelRef) {
    throw new Error("No active model is available to run the subagent.");
  }

  const [approvalModes, approvedToolsByConversation] = await Promise.all([
    repositories.configRepository.getConversationApprovalModes(),
    repositories.configRepository.getApprovedToolsByConversation(),
  ]);
  const approvalMode: ToolApprovalMode = parent?.autoApprove
    ? "auto"
    : parent
      ? (approvalModes[parent.conversationId] ?? "ask")
      : "ask";
  const approvedToolNames = parent
    ? (approvedToolsByConversation[parent.conversationId] ?? [])
    : [];

  const fileContextSource =
    parent?.fileContextSource ??
    (parent?.externalFolderSession ? "external-folder" : null);
  const externalFolderSession =
    fileContextSource === "external-folder"
      ? (parent?.externalFolderSession ?? null)
      : null;
  const selectedFileIds = parent?.selectedFileIds ?? [];

  const conversation = await repositories.conversationRepository.create({
    agentId: agent.id,
    agentMode: "build",
    externalFolderSession: parent?.externalFolderSession ?? null,
    modelId: modelRef.modelId,
    parentConversationId: parent?.conversationId ?? null,
    providerId: modelRef.providerId,
    reasoningEffort: parent?.reasoningEffort ?? "medium",
    relationshipToParent: "subagent",
    rootConversationId: parent
      ? (parent.rootConversationId ?? parent.conversationId)
      : null,
    selectedFileIds: [],
    selectedMcpServerIds: parent?.selectedMcpServerIds ?? null,
    selectedSkillIds: parent?.selectedSkillIds ?? [],
    title: input.description,
  });

  // Persist inherited approval policy once, before the run starts, so the
  // child's approval drawer and notification titles resolve correctly even
  // while the parent is blocked inside the task tool.
  if (approvalMode !== "ask") {
    await repositories.configRepository.setConversationApprovalModes({
      ...approvalModes,
      [conversation.id]: approvalMode,
    });
  }
  if (approvedToolNames.length > 0) {
    await repositories.configRepository.setApprovedToolsByConversation({
      ...approvedToolsByConversation,
      [conversation.id]: approvedToolNames,
    });
  }

  parentDeps.publishSubagentConversation?.({
    approvalMode,
    approvedToolNames,
    conversation,
  });

  const appliedSkillIds = resolveAppliedSkills({
    content: input.prompt,
    selectedSkillIds: conversation.selectedSkillIds,
    skills: snapshot.skills,
  }).map((skill) => skill.id);
  const userMetadataEntries: MessageMetadata = {};
  if (selectedFileIds.length > 0 || fileContextSource) {
    userMetadataEntries.externalFolderDisplayName =
      externalFolderSession?.displayName ?? null;
    if (fileContextSource) {
      userMetadataEntries.fileContextSource = fileContextSource;
    }
    if (selectedFileIds.length > 0) {
      userMetadataEntries.selectedFileIds = selectedFileIds;
    }
  }
  if (appliedSkillIds.length > 0) {
    userMetadataEntries.appliedSkillIds = appliedSkillIds;
  }
  const userMetadata = Object.keys(userMetadataEntries).length > 0
    ? userMetadataEntries
    : null;

  const userSequence = await repositories.messageRepository.getNextSequence(
    conversation.id,
  );
  const userMessage = await repositories.messageRepository.create({
    content: input.prompt,
    conversationId: conversation.id,
    metadata: userMetadata,
    role: "user",
    sequence: userSequence,
    status: "completed",
  });
  const assistantMessage = await repositories.messageRepository.create({
    content: "",
    conversationId: conversation.id,
    role: "assistant",
    sequence: userSequence + 1,
    status: "streaming",
  });
  const childRun = await repositories.agentRunRepository.create({
    agentId: agent.id,
    agentMode: "build",
    assistantMessageId: assistantMessage.id,
    autoApprove: approvalMode === "auto",
    conversationId: conversation.id,
    externalFolderSession,
    fileContextSource,
    input: input.prompt,
    modelId: modelRef.modelId,
    providerId: modelRef.providerId,
    selectedFileIds,
    status: "queued",
    userMessageId: userMessage.id,
  });

  const childUi =
    parentDeps.createRunUi?.({
      conversationId: conversation.id,
      runId: childRun.id,
    }) ?? SUBAGENT_NOOP_UI;

  const childDeps: AgentRunDeps = {
    ...parentDeps,
    generateAndApplyConversationTitle: async () => {},
    notifyRunStateChange: async () => {},
    requestToolApproval: (childRunRecord, request) =>
      parentDeps.requestToolApproval(childRunRecord, request),
    retryRun: (retryRunId, delayMs) => {
      setTimeout(() => {
        void executeClaimedAgentRun(retryRunId, childDeps).catch(() => {});
      }, delayMs);
    },
    shouldKeepBackgroundAgentAlive,
    refreshScheduler,
    ui: childUi,
  };

  if (!runRegistry.claim(childRun.id)) {
    throw new Error("Subagent run could not be started.");
  }

  const onParentAbort = () => {
    runRegistry.stopRun(childRun.id);
  };

  input.abortSignal?.addEventListener("abort", onParentAbort);

  try {
    await executeClaimedAgentRun(childRun.id, childDeps);
  } finally {
    input.abortSignal?.removeEventListener("abort", onParentAbort);

    const updatedAt = new Date().toISOString();
    await repositories.conversationRepository
      .updateMetadata(conversation.id, { updatedAt })
      .catch(() => {});
    // A user may have renamed the child while it ran; publish the row as it
    // exists now instead of the snapshot captured at creation.
    const finishedConversation =
      (await repositories.conversationRepository
        .getById(conversation.id)
        .catch(() => null)) ?? { ...conversation, updatedAt };
    parentDeps.publishSubagentConversation?.({
      approvalMode,
      approvedToolNames,
      conversation: finishedConversation,
    });
    parentDeps.promoteAfterRun?.(childRun.id);
  }

  const childMessages =
    await repositories.messageRepository.listByConversation(conversation.id);
  const runAssistants = childMessages.filter(
    (message) =>
      message.role === "assistant" &&
      message.metadata?.runId === childRun.id,
  );
  const failedAssistant = runAssistants.find(
    (message) => message.status === "failed",
  );

  if (failedAssistant) {
    throw new Error(
      failedAssistant.error ?? "Subagent did not produce a result.",
    );
  }

  const output = runAssistants
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");

  if (!output) {
    throw new Error("Subagent did not produce a result.");
  }

  return { conversationId: conversation.id, output };
}
