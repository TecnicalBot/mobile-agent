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
  createRepositories,
} from "@/lib/db/database";
import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import {
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
import { modelRuntime } from "@/lib/runtime/model-runtime";
import { createExecutionTimelineEvent } from "@/lib/runtime/run-artifacts";
import { partitionSelectedFiles } from "@/lib/runtime/message-conversion";
import {
  buildRunStatusByConversation,
  createRunControllerRegistry,
  createPendingToolApproval,
  isActiveAgentRunStatus,
  shouldAutoResumeRun,
} from "@/lib/runtime/run-manager";
import { secureSecretStore } from "@/lib/secrets";
import { connectMcpOAuth } from "@/lib/mcp/oauth";
import { createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";
import { createModelRef } from "@/types/app-state";
import type {
  AgentRun,
  AppSettings,
  AppStateSnapshot,
  BuiltInToolSettings,
  Conversation,
  ExternalFolderSession,
  McpServerAuthMode,
  McpServerConfig,
  McpServerTransport,
  MemoryEntry,
  ModelRef,
  PendingToolApproval,
  PendingToolApprovalRequest,
  ProviderConfig,
  ReasoningEffort,
  ResolvedConfig,
  ResolvedModel,
  SendMessageInput,
  SkillConfig,
  StoredMessage,
  WorkspaceFile,
} from "@/types/app-state";

import {
  EMPTY_SNAPSHOT,
  buildConversationTitle,
  normalizeGeneratedConversationTitle,
} from "./constants";
import {
  buildAssistantMetadata,
  buildMessageDebugSummary,
  logMessageDebug,
  resolveAppliedSkills,
  resolveFileContextSource,
  upsertAgentRun,
  upsertConversation,
  upsertMessages,
  upsertWorkspaceFiles,
} from "./helpers";
import { resolveConfig } from "./config-resolution";
import { executeClaimedAgentRun, type AgentRunDeps } from "./agent-run";

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
  writeMemory: (content: string) => Promise<MemoryEntry>;
  currentConversation: Conversation | null;
  currentExternalFolderSession: ExternalFolderSession | null;
  pendingToolApproval: PendingToolApproval | null;
  denyPendingToolApproval: () => void;
  deleteMcpServer: (serverId: string) => Promise<void>;
  dismissInAppNotification: () => void;
  deleteModelPreset: (modelPresetId: string) => Promise<void>;
  clearMemory: () => Promise<void>;
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
  memory: MemoryEntry | null;
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
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
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

const AppStateContext = createContext<AppStateContextValue | null>(null);

function getHeaderNames(headers?: Record<string, string>) {
  return Object.entries(headers ?? {})
    .filter(([name, value]) => name.trim() && value.trim())
    .map(([name]) => name.trim());
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
    decision: import("@/lib/runtime/run-manager").ToolApprovalDecision,
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
      return "approve" satisfies import("@/lib/runtime/run-manager").ToolApprovalDecision;
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

    return await new Promise<import("@/lib/runtime/run-manager").ToolApprovalDecision>((resolve) => {
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
      const memory = await repositories.memoryStore.read();
      const mcpServers = await repositories.mcpServerRepository.list();
      const skills = await repositories.skillRepository.list();
      const workspaceFiles = await repositories.workspaceRepository.list();
      const nextSnapshot = {
        agentRuns: normalizedAgentRuns,
        conversations,
        currentConversation,
        currentSelectedFileIds: currentConversation?.selectedFileIds ?? [],
        currentSelectedSkillIds: currentConversation?.selectedSkillIds ?? [],
        memory,
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
    const file =
      await repositoriesRef.current.workspaceRepository.getById(fileId);

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

    try {
      await connectMcpOAuth(server);
      await repositoriesRef.current.mcpServerRepository.updateConnectionState(
        serverId,
        {
          lastError: null,
          lastStatus: "untested",
        },
      );
    } catch (error) {
      await repositoriesRef.current.mcpServerRepository.updateConnectionState(
        serverId,
        {
          lastError: error instanceof Error ? error.message : String(error),
          lastStatus: "failed",
        },
      );
      throw error;
    } finally {
      await hydrate();
    }
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

  async function writeMemory(content: string) {
    const memory = await repositoriesRef.current.memoryStore.write(content);
    await hydrate();
    return memory;
  }

  async function clearMemory() {
    await repositoriesRef.current.memoryStore.clear();
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

  async function setReasoningEffort(effort: ReasoningEffort) {
    const currentConversation = snapshotRef.current.currentConversation;

    if (!currentConversation) {
      return;
    }

    await repositoriesRef.current.conversationRepository.updateMetadata(
      currentConversation.id,
      { reasoningEffort: effort },
    );

    setSnapshot((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === currentConversation.id
          ? { ...conversation, reasoningEffort: effort }
          : conversation,
      ),
      currentConversation:
        current.currentConversation?.id === currentConversation.id
          ? { ...current.currentConversation, reasoningEffort: effort }
          : current.currentConversation,
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
      const deps: AgentRunDeps = {
        repositories: repositoriesRef.current,
        snapshotRef,
        runRegistry: runRegistryRef.current,
        workspaceService: workspaceServiceRef.current,
        updateRunRecord,
        requestToolApproval,
        generateAndApplyConversationTitle,
        notifyRunStateChange,
        setSnapshot,
        setError,
        setPendingToolApprovals,
      };

      await executeClaimedAgentRun(runId, deps);
    } catch (error) {
      runRegistryRef.current.clear(runId);
      throw error;
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
    const userMetadataEntries: import("@/types/app-state").MessageMetadata = {};

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

    const userMetadata: import("@/types/app-state").MessageMetadata | null =
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
        writeMemory,
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
        clearMemory,
        deleteModelPreset,
        deleteSkill,
        deleteWorkspaceFile,
        disconnectOpenAIOAuth,
        error,
        hydrating,
        importFiles,
        inAppNotification,
        messages: snapshot.messages,
        memory: snapshot.memory,
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
        reasoningEffort:
          snapshot.currentConversation?.reasoningEffort ?? "medium",
        setReasoningEffort,
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
    writeMemory: context.writeMemory,
    createProvider: context.createProvider,
    createModelPreset: context.createModelPreset,
    createSkill: context.createSkill,
    createWorkspaceFile: context.createWorkspaceFile,
    deleteMcpServer: context.deleteMcpServer,
    clearMemory: context.clearMemory,
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
    memory: context.memory,
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
    reasoningEffort: context.reasoningEffort,
    setReasoningEffort: context.setReasoningEffort,
    setCurrentSelectedFileIds: context.setCurrentSelectedFileIds,
    setCurrentSelectedSkillIds: context.setCurrentSelectedSkillIds,
    refreshWorkspaceFiles: context.refreshWorkspaceFiles,
    workspaceFiles: context.workspaceFiles,
    deleteConversation: context.deleteConversation,
  };
}
