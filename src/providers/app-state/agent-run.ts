import type { ToolSet } from "ai";
import type { RefObject } from "react";

import { fetchLiveModelCatalogCached } from "@/modules/config/live-model-catalog";
import { resolveConfiguredModel } from "@/modules/config/registry";
import { prepareMessagesForLLM } from "@/modules/context";
import type { Repositories } from "@/core/db/repositories/types";
import { createMcpRuntimeTools } from "@/modules/mcp/runtime-tools";
import {
  buildMemorySystemPrompt,
  createMemoryTools,
} from "@/modules/memory/memory-tools";
import { resolveOnDeviceRuntimePolicy } from "@/modules/on-device/runtime-policy";
import {
  convertStoredMessagesToModelMessages,
  partitionSelectedFiles,
} from "@/modules/runtime/message-conversion";
import { modelRuntime } from "@/modules/runtime/model-runtime";
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
import { summarizeValue } from "@/modules/tools/built-in/shared";
import {
  buildExternalFolderSystemPrompt,
  createExternalFolderTools,
} from "@/modules/tools/external-folder-tools";
import {
  startBackgroundAgent,
  stopBackgroundAgent,
} from "background-agent-service";
import { dismissApprovalNotification } from "@/modules/notifications/run-notifications";
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
  Conversation,
  ExternalFolderSession,
  MemoryEvent,
  MessageMetadata,
  PendingToolApprovalRequest,
  PromptArtifact,
  ProviderConfig,
  ReasoningBlock,
  ResolvedModel,
  StoredMessage,
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
  filterToolsBySettings,
  upsertAgentRun,
  upsertMessages,
} from "./helpers";
import { isUiProjectionFailure, type RunUiPublisher } from "./run-ui-publisher";

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
  generateAndApplyConversationTitle: (input: {
    conversation: Conversation;
    firstUserMessage: string;
    model: ResolvedModel;
    provider: ProviderConfig;
    runId: string;
  }) => Promise<void>;
  notifyRunStateChange: (input: {
    body: string;
    conversationId: string;
    status: "success" | "failed";
    title: string;
  }) => Promise<void>;
  ui: RunUiPublisher;
  retryRun: (runId: string, delayMs: number) => void;
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
    generateAndApplyConversationTitle,
    notifyRunStateChange,
    ui,
    retryRun,
  } = deps;

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

  const conversation =
    snapshotRef.current.conversations.find(
      (item) => item.id === run.conversationId,
    ) ??
    (await repositories.conversationRepository.getById(run.conversationId));

  if (!conversation) {
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: "Chat not found.",
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  const provider = snapshotRef.current.resolvedConfig.providers.find(
    (item) => item.id === run.providerId,
  );

  if (!provider) {
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: `Provider ${run.providerId} is unavailable.`,
      status: "failed",
    });
    runRegistry.clear(runId);
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

  const resumedRun = await safeUpdateRunRecord(run.id, {
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
  const onDevicePolicy = await resolveOnDeviceRuntimePolicy(resolvedModel);
  const runtimeSupportsTools = onDevicePolicy.toolsEnabled;

  if (imageFiles.length > 0 && !resolvedModel.supportsImageInput) {
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError:
        "The current model does not support image input. Switch to a vision-capable model to send images.",
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  if (binaryFiles.length > 0 && !runtimeSupportsTools) {
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError:
        onDevicePolicy.memoryConstrained && onDevicePolicy.toolsMode === "auto"
          ? "Tools are off in memory-safe mode. Enable tools for this model, then try the attachment again."
          : "Binary file attachments require a tool-capable model for this chat.",
      status: "failed",
    });
    runRegistry.clear(runId);
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
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError:
        "This conversation includes image attachments, but the current model cannot read images.",
      status: "failed",
    });
    runRegistry.clear(runId);
    return;
  }

  let runtimeMessages = runtimeMessageResult.messages;
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
  ] as import("@/core/types/app-state").ExecutionTimelineEvent[];
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
  const externalFolderSession: ExternalFolderSession | null =
    run.fileContextSource === "external-folder"
      ? run.externalFolderSession
      : null;
  const runMcpServers =
    conversation.selectedMcpServerIds === null
      ? snapshotRef.current.mcpServers
      : snapshotRef.current.mcpServers.filter((server) =>
          conversation.selectedMcpServerIds!.includes(server.id),
        );
  const selectedWorkspaceToolFileIds = currentRunWorkspaceFiles.map(
    (file) => file.id,
  );

  const pushTimelineEvent = (
    event: import("@/core/types/app-state").ExecutionTimelineEvent,
  ) => {
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
    await safeUpdateRunRecord(run.id, {
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
  let refreshAssistantState: null | (() => void) = null;
  const pendingArtifactWrites: Promise<void>[] = [];
  let assistantText = startingAssistantText;
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
          msg.id === assistantMessage.id
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

    if (status !== "streaming" && snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
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
    if (snapshotRef.current.settings.backgroundAgentEnabled) {
      startBackgroundAgent();
    }

    const builtInRuntimeTools: ToolSet | undefined =
      runtimeSupportsTools && run.fileContextSource === "external-folder"
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
                snapshotRef.current.settings.builtInToolSettings.folderReadFile,
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
        : runtimeSupportsTools
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
      runtimeSupportsTools && runMcpServers.length > 0
         ? await createMcpRuntimeTools({
             servers: runMcpServers,
             onRecord: handleToolExecutionRecord,
             signal: abortController.signal,
           })
        : null;
    const memoryRuntime =
      runtimeSupportsTools && snapshotRef.current.settings.memoryEnabled
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
    const workspaceRuntimeSystem =
      run.fileContextSource !== "external-folder" &&
      builtInRuntimeTools &&
      ("createFile" in builtInRuntimeTools || "writeFile" in builtInRuntimeTools)
        ? buildWorkspaceSystemPrompt()
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
      mcpServers: runMcpServers,
      skills: appliedSkills,
    });
    const memoryRuntimeSystem = snapshotRef.current.settings.memoryEnabled
      ? buildMemorySystemPrompt(snapshotRef.current.memory, {
          canWrite: runtimeSupportsTools,
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
        workspaceRuntimeSystem,
        mcpRuntime?.systemPrompt,
        memoryRuntimeSystem,
        skillsRuntimeSystem,
        toolLoopRuntimeSystem,
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
      const liveModels = await fetchLiveModelCatalogCached();
      const liveModel = liveModels.find(
        (m) =>
          m.id === resolvedModel.modelId ||
          m.id.endsWith(`/${resolvedModel.modelId}`),
      );
      contextWindowFromCatalog = liveModel?.contextWindow ?? null;
    } catch {}

    if (
      contextWindowFromCatalog === null &&
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

    const contextResult = prepareMessagesForLLM({
      contextWindow: contextWindowFromCatalog,
      messages: runtimeMessages,
      model: resolvedModel,
      systemPrompt: runtimeSystem,
      tools: runtimeTools,
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

    runtimeMessages = contextResult.messages;

    if (contextResult.didPrune || contextResult.didTruncate) {
      pushTimelineEvent(
        createExecutionTimelineEvent({
          detail: `Context managed: ${contextResult.didPrune ? "pruned tool outputs" : ""}${contextResult.didPrune && contextResult.didTruncate ? " + " : ""}${contextResult.didTruncate ? "truncated old messages" : ""} (${contextResult.budget.usable} token budget)`,
          kind: "run",
          status: "info",
          title: "Context managed",
          createdAt: new Date().toISOString(),
        }),
      );
    }

    pushTimelineEvent(
      createExecutionTimelineEvent({
        detail: `${resolvedModel.providerLabel} · ${resolvedModel.label}`,
        kind: "run",
        status: "info",
        title: "Run started",
        createdAt: resumedRun?.startedAt ?? run.startedAt,
      }),
    );

    const runtimeResultPromise = modelRuntime.generateTextStream({
      abortSignal: abortController.signal,
      maxToolSteps: snapshotRef.current.settings.maxToolSteps,
      messages: runtimeMessages,
      model: resolvedModel,
      onDelta: (delta) => {
        markActivity();
        assistantText += delta;
        schedulePersist("streaming");
        scheduleSnapshot("streaming");
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
      reasoning:
        resolvedModel.supportsReasoning ||
        (provider.family === "openai-compatible" &&
          resolvedModel.transport === "openaiCompatible")
          ? conversation.reasoningEffort
          : undefined,
      secretStore: secureSecretStore,
      sessionId: run.id,
      system: runtimeSystem,
      tools: runtimeTools,
    });

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

    const runtimeResult = await runtimeResultPromise;
    await persistArtifacts;

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
      contextWindow: contextWindowFromCatalog,
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
    await safeUpdateRunRecord(run.id, {
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
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
                  ...assistantMessage,
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

    await notifyRunStateChange({
      body: "Agent finished this task.",
      conversationId: conversation.id,
      status: "success",
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
        reasoning: reasoning.map((block) => ({
          ...block,
          completedAt: block.completedAt ?? new Date().toISOString(),
        })),
        runId: run.id,
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
                    ...assistantMessage,
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
      reasoning: reasoning.map((block) => ({
        ...block,
        completedAt: block.completedAt ?? new Date().toISOString(),
      })),
      runId: run.id,
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
                  ...assistantMessage,
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
        body: errorMessage,
        conversationId: conversation.id,
        status: "failed",
        title: conversation.title,
      }).catch(() => {});
    }
  } finally {
    dismissApprovalNotification(run.id).catch(() => {});

    if (snapshotRef.current.settings.backgroundAgentEnabled) {
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
