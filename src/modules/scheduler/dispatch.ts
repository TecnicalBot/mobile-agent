import type { RefObject } from "react";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import type { Repositories } from "@/core/db/repositories/types";
import { notifyRunFinishedAsync } from "@/modules/notifications/run-notifications";
import { createRunControllerRegistry } from "@/modules/runtime/run-manager";
import { createExecutionTimelineEvent } from "@/modules/runtime/run-artifacts";
import type {
  AgentRun,
  AppStateSnapshot,
  Conversation,
  PendingToolApproval,
  Schedule,
  StoredMessage,
} from "@/core/types/app-state";
import { executeClaimedAgentRun, executeSubagentTask, type AgentRunDeps } from "@/providers/app-state/agent-run";
import { resolveConfig } from "@/providers/app-state/config-resolution";
import { buildAssistantMetadata } from "@/providers/app-state/helpers";
import type { RunUiPublisher } from "@/providers/app-state/run-ui-publisher";

export type CreateScheduledRunResult = {
  agentRun: AgentRun;
  assistantMessage: StoredMessage;
  conversation: Conversation;
  userMessage: StoredMessage;
};

export async function createScheduledRun(
  repositories: Repositories,
  schedule: Schedule,
): Promise<CreateScheduledRunResult> {
  let currentSchedule = schedule;
  let conversationId = schedule.conversationId;
  let conversation: Conversation | null = null;

  if (conversationId) {
    conversation = await repositories.conversationRepository.getById(conversationId);
  }

  if (!conversation) {
    conversation = await repositories.conversationRepository.create({
      title: schedule.title,
      providerId: schedule.providerId,
      modelId: schedule.modelId,
    });
    conversationId = conversation.id;

    if (schedule.externalFolderSession) {
      await repositories.conversationRepository.updateMetadata(
        conversation.id,
        { externalFolderSession: schedule.externalFolderSession },
      );
      conversation = {
        ...conversation,
        externalFolderSession: schedule.externalFolderSession,
      };
    }

    if (schedule.conversationId !== conversation.id) {
      await repositories.scheduleRepository.update(schedule.id, {
        conversationId: conversation.id,
      });
      currentSchedule = { ...schedule, conversationId: conversation.id };
    }
  }

  const userSequence = await repositories.messageRepository.getNextSequence(
    conversation.id,
  );
  const assistantSequence = userSequence + 1;

  const userMessage = await repositories.messageRepository.create({
    conversationId: conversation.id,
    content: currentSchedule.prompt,
    role: "user",
    sequence: userSequence,
    status: "completed",
  });
  const assistantMessage = await repositories.messageRepository.create({
    conversationId: conversation.id,
    content: "",
    role: "assistant",
    sequence: assistantSequence,
    status: "streaming",
  });
  const agentRun = await repositories.agentRunRepository.create({
    agentId: currentSchedule.agentId,
    agentMode: "build",
    assistantMessageId: assistantMessage.id,
    autoApprove: currentSchedule.autoApprove,
    conversationId: conversation.id,
    externalFolderSession: currentSchedule.externalFolderSession,
    fileContextSource: currentSchedule.externalFolderSession
      ? "external-folder"
      : null,
    input: currentSchedule.prompt,
    modelId: currentSchedule.modelId,
    providerId: currentSchedule.providerId,
    selectedFileIds: [],
    status: "queued",
    userMessageId: userMessage.id,
  });

  const assistantMetadata = buildAssistantMetadata({
    executionTimeline: [
      createExecutionTimelineEvent({
        detail: "Scheduled job",
        kind: "run",
        status: "pending",
        title: "Scheduled job queued",
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

  await repositories.scheduleRunRepository.create({
    scheduleId: currentSchedule.id,
    runId: agentRun.id,
    status: "queued",
    startedAt: agentRun.startedAt,
  });

  return { agentRun, assistantMessage, conversation, userMessage };
}

export function createHeadlessRunPublisher(): RunUiPublisher {
  return {
    publishApprovals: (_updater: (current: PendingToolApproval[]) => PendingToolApproval[]) => {},
    publishError: (_message: string) => {},
    publishSnapshot: () => {},
  };
}

export async function buildHeadlessSnapshot(
  repositories: Repositories,
): Promise<AppStateSnapshot> {
  const settings = await repositories.configRepository.getSettings();
  const conversations = await repositories.conversationRepository.list();
  const currentConversation = conversations[0] ?? null;
  const agentRuns = await repositories.agentRunRepository.list();
  const messages = currentConversation
    ? await repositories.messageRepository.listByConversation(currentConversation.id)
    : [];
  const memory = await repositories.memoryStore.read();
  const mcpServers = await repositories.mcpServerRepository.list();
  const savedPrompts = await repositories.savedPromptRepository.list();
  const schedules = await repositories.scheduleRepository.list();
  const skills = await repositories.skillRepository.list();
  const workspaceFiles = await repositories.workspaceRepository.list();
  const agents = await repositories.agentRepository.list();
  const resolvedConfig = await resolveConfig(
    {
      modelPresets: await repositories.configRepository.listModelPresets(),
      providers: await repositories.configRepository.listProviderConfigs(),
      settings,
    },
    { discoverRemote: false },
  );

  return {
    agentRuns,
    agents,
    conversations,
    currentConversation,
    currentSelectedAgentId: currentConversation?.agentId ?? null,
    currentSelectedFileIds: currentConversation?.selectedFileIds ?? [],
    currentSelectedMcpServerIds:
      currentConversation?.selectedMcpServerIds ?? null,
    currentSelectedSkillIds: currentConversation?.selectedSkillIds ?? [],
    memory,
    mcpServers,
    messages,
    savedPrompts,
    schedules,
    skills,
    workspaceFiles,
    resolvedConfig,
    settings,
  } satisfies AppStateSnapshot;
}

export function buildHeadlessAgentRunDeps(input: {
  repositories: Repositories;
  runRegistry: ReturnType<typeof createRunControllerRegistry>;
  snapshotRef: RefObject<AppStateSnapshot>;
  workspaceService: ReturnType<typeof createWorkspaceFileService>;
}): AgentRunDeps {
  const { repositories, runRegistry, snapshotRef, workspaceService } = input;

  const deps: AgentRunDeps = {
    repositories,
    snapshotRef,
    runRegistry,
    workspaceService,
    updateRunRecord: async (runId, runInput) => {
      await repositories.agentRunRepository.update(runId, runInput);
      return repositories.agentRunRepository.getById(runId);
    },
    requestToolApproval: async () => "deny" as const,
    requestRunQuestionnaire: async () => null,
    generateAndApplyConversationTitle: async () => {},
    notifyRunStateChange: async ({ body, conversationId, status, title }) => {
      if (snapshotRef.current.settings.notificationSettings.runFinished) {
        await notifyRunFinishedAsync({
          body,
          conversationId,
          status,
          title,
        });
      }
    },
    onSkillsChange: () => {},
    onAgentsChange: () => {},
    ui: createHeadlessRunPublisher(),
    retryRun: (runId, delayMs) => {
      setTimeout(() => {
        void executeClaimedAgentRun(runId, deps).catch(() => {});
      }, delayMs);
    },
    shouldKeepBackgroundAgentAlive: () => runRegistry.hasActiveRuns(),
    refreshScheduler: () => {},
    spawnSubagent: (task) => executeSubagentTask(deps, task),
  };

  return deps;
}

export async function dispatchScheduledRunHeadless(
  repositories: Repositories,
  schedule: Schedule,
): Promise<AgentRun> {
  const { agentRun } = await createScheduledRun(repositories, schedule);
  const snapshot = await buildHeadlessSnapshot(repositories);
  const snapshotRef: RefObject<AppStateSnapshot> = { current: snapshot };
  const runRegistry = createRunControllerRegistry();
  const workspaceService = createWorkspaceFileService(
    repositories.workspaceRepository,
  );

  await executeClaimedAgentRun(
    agentRun.id,
    buildHeadlessAgentRunDeps({
      repositories,
      runRegistry,
      snapshotRef,
      workspaceService,
    }),
  );

  return agentRun;
}
