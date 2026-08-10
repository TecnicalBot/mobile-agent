import type { DocumentPickerAsset } from "expo-document-picker";
import * as Crypto from "expo-crypto";
import { useSQLiteContext } from "expo-sqlite";
import { colorScheme } from "nativewind";
import {
    createContext,
    useCallback,
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

import { createRepositories } from "@/core/db/database";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { connectMcpOAuth } from "@/modules/mcp/oauth";
import { testMcpServerConnection } from "@/modules/mcp/runtime-tools";
import {
    dismissApprovalNotification,
    dismissRunNotificationsAsync,
    dismissStaleApprovalNotificationsAsync,
    notifyApprovalRequestedAsync,
    notifyRunFinishedAsync,
    prepareRunNotificationsAsync,
} from "@/modules/notifications/run-notifications";
import { setBackgroundAgentNotificationState } from "background-agent-service";
import { setProtectedApps } from "device-automation";
import {
    clearOpenAiTokens,
    getOpenAiAccessToken,
    getOpenAiRefreshToken,
    getOpenAiTokenInfo,
    handleLogin,
} from "@/modules/providers/openai-oauth";
import { getSupportedProviderDefinition } from "@/modules/providers";
import { partitionSelectedFiles } from "@/modules/runtime/message-conversion";
import { modelRuntime } from "@/modules/runtime/model-runtime";
import { createExecutionTimelineEvent } from "@/modules/runtime/run-artifacts";
import {
    buildRunStatusByConversation,
    createPendingQuestionnaire,
    createPendingToolApproval,
    createRunControllerRegistry,
    isActiveAgentRunStatus,
    shouldAutoResumeRun,
} from "@/modules/runtime/run-manager";
import { secureSecretStore } from "@/core/services/secrets";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import {
    parseSkillMarkdown,
    serializeSkillToMarkdown,
} from "@/modules/skills/skill-markdown";
import type {
    AgentMode,
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
    PendingQuestionnaire,
    PendingQuestionnaireAnswer,
    PendingToolApproval,
    PendingToolApprovalRequest,
    ProviderConfig,
    ReasoningEffort,
    ResolvedConfig,
    ResolvedModel,
    SavedPrompt,
    SendMessageInput,
    SkillConfig,
    StoredMessage,
    WorkspaceFile,
} from "@/core/types/app-state";
import { createModelRef } from "@/core/types/app-state";

import { executeClaimedAgentRun, type AgentRunDeps } from "./agent-run";
import { createRunUiPublisher } from "./run-ui-publisher";
import { resolveConfig } from "./config-resolution";
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

type AppStateContextValue = {
    resolveNotificationApproval: (input: {
        approvalId: string;
        decision: "approve" | "deny";
        runId: string;
    }) => Promise<void>;
    updateNotificationSettings: (
        input: Partial<AppSettings["notificationSettings"]>,
    ) => Promise<void>;
    approvePendingToolApproval: () => void;
    pendingQuestionnaire: PendingQuestionnaire | null;
    submitPendingQuestionnaire: (
        answers: PendingQuestionnaireAnswer[],
    ) => void;
    dismissPendingQuestionnaire: () => void;
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
    createMcpServerOAuth: (input: {
        enabled?: boolean;
        label: string;
        oauthAllowedAuthOrigin?: string | null;
        oauthAuthorizationUrl?: string | null;
        oauthClientId?: string | null;
        oauthScopes?: string | null;
        oauthTokenUrl?: string | null;
        transport: McpServerTransport;
        url: string;
    }) => Promise<McpServerConfig>;
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
        apiKey?: string;
        authType: ProviderConfig["authType"];
        baseUrl?: string | null;
        enabled?: boolean;
        family: ProviderConfig["family"];
        id: string;
        label: string;
        oauthAccountEmail?: string | null;
    }) => Promise<ProviderConfig>;
    createConversation: () => Promise<void>;
    deleteProvider: (providerId: string) => Promise<void>;
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
    importSkillMarkdown: (input: {
        markdown: string;
        replaceById?: string | null;
    }) => Promise<SkillConfig>;
    exportSkillMarkdown: (skillId: string) => string;
    createSavedPrompt: (input: {
        content: string;
        title: string;
    }) => Promise<SavedPrompt>;
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
    deleteSavedPrompt: (savedPromptId: string) => Promise<void>;
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
    currentSelectedMcpServerIds: string[] | null;
    currentSelectedSkillIds: string[];
    memory: MemoryEntry | null;
    messages: StoredMessage[];
    editAndResendMessage: (messageId: string, content: string) => Promise<void>;
    savedPrompts: SavedPrompt[];
    mcpServers: McpServerConfig[];
    resumePendingRuns: () => Promise<void>;
    retryRun: (runId: string) => Promise<void>;
    runStatusByConversation: Record<string, AgentRun["status"] | null>;
    pickConversationFolder: () => Promise<ExternalFolderSession>;
    clearConversationFolder: () => Promise<void>;
    ready: boolean;
    refresh: () => Promise<void>;
    refreshWorkspaceFiles: () => Promise<void>;
    renameConversation: (
        conversationId: string,
        title: string,
    ) => Promise<void>;
    resolvedConfig: ResolvedConfig;
    saveProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
    saveMcpServerHeaderValues: (
        serverId: string,
        headers: Record<string, string>,
    ) => Promise<void>;
    selectConversation: (conversationId: string) => Promise<void>;
    setConversationPinned: (
        conversationId: string,
        pinned: boolean,
    ) => Promise<void>;
    selectModel: (modelRef: ModelRef) => Promise<void>;
    sendMessage: (input: SendMessageInput) => Promise<void>;
    sending: boolean;
    stopSending: () => Promise<void>;
    reasoningEffort: ReasoningEffort;
    setReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
    agentMode: AgentMode;
    setAgentMode: (mode: AgentMode) => Promise<void>;
    setCurrentSelectedFileIds: (selectedFileIds: string[]) => Promise<void>;
    setCurrentSelectedMcpServerIds: (
        selectedMcpServerIds: string[] | null,
    ) => Promise<void>;
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
    updateProtectedApps: (packageNames: string[]) => Promise<void>;
    updateToolApprovalMode: (
        mode: AppSettings["toolApprovalMode"],
    ) => Promise<void>;
    updateMaxToolSteps: (maxToolSteps: number) => Promise<void>;
    updateThemeMode: (mode: AppSettings["themeMode"]) => Promise<void>;
    updateBackgroundAgentEnabled: (enabled: boolean) => Promise<void>;
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
    updateSavedPrompt: (
        savedPromptId: string,
        input: {
            content?: string;
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
    if (runRegistryRef.current.version !== 3) {
        runRegistryRef.current = createRunControllerRegistry();
    }
    const [snapshot, setSnapshot] = useState<AppStateSnapshot>(EMPTY_SNAPSHOT);
    const [ready, setReady] = useState(false);
    const [hydrating, setHydrating] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pendingToolApprovals, setPendingToolApprovals] = useState<
        PendingToolApproval[]
    >([]);
    const [pendingQuestionnaires, setPendingQuestionnaires] = useState<
        PendingQuestionnaire[]
    >([]);
    const [inAppNotification, setInAppNotification] = useState<{
        body: string;
        conversationId: string;
        id: string;
        title: string;
    } | null>(null);
    const snapshotRef = useRef(snapshot);
    const pendingToolApprovalsRef = useRef<PendingToolApproval[]>(
        pendingToolApprovals,
    );
    const pendingQuestionnairesRef = useRef<PendingQuestionnaire[]>(
        pendingQuestionnaires,
    );
    const appStateRef = useRef(AppState.currentState);
    const legacyProviderSecretCleanedRef = useRef(false);
    const hydrationGenerationRef = useRef(0);
    const coldStartRef = useRef(true);
    const executeAgentRunRef = useRef<(runId: string) => Promise<void>>(
        async () => {},
    );

    snapshotRef.current = snapshot;
    pendingToolApprovalsRef.current = pendingToolApprovals;
    pendingQuestionnairesRef.current = pendingQuestionnaires;

    useEffect(() => {
        logMessageDebug("snapshot-updated", {
            currentConversationId: snapshot.currentConversation?.id ?? null,
            messages: buildMessageDebugSummary(snapshot.messages),
        });
    }, [snapshot.currentConversation?.id, snapshot.messages]);

    function resolvePendingToolApproval(
        approval: PendingToolApproval,
        decision: import("@/modules/runtime/run-manager").ToolApprovalDecision,
    ) {
        runRegistryRef.current.resolvePendingApproval(
            approval.runId,
            approval.id,
            decision,
        );
        setPendingToolApprovals((current) =>
            current.filter((item) => item.id !== approval.id),
        );
        dismissApprovalNotification(approval.runId).catch(() => { });

        if (snapshotRef.current.settings.backgroundAgentEnabled) {
            setBackgroundAgentNotificationState("running").catch(() => { });
        }
    }

    function resolvePendingQuestionnaire(
        questionnaire: PendingQuestionnaire,
        answers: PendingQuestionnaireAnswer[] | null,
    ) {
        runRegistryRef.current.resolvePendingQuestionnaire(
            questionnaire.runId,
            questionnaire.id,
            answers,
        );
        setPendingQuestionnaires((current) =>
            current.filter((item) => item.id !== questionnaire.id),
        );

        if (snapshotRef.current.settings.backgroundAgentEnabled) {
            setBackgroundAgentNotificationState("running").catch(() => { });
        }
    }

    async function requestRunQuestionnaire(
        run: AgentRun,
        request: import("@/core/types/app-state").PendingQuestionnaireRequest,
    ): Promise<PendingQuestionnaireAnswer[] | null> {
        const conversation =
            snapshotRef.current.conversations.find(
                (item) => item.id === run.conversationId,
            ) ?? snapshotRef.current.currentConversation;
        const questionnaire = createPendingQuestionnaire(
            run,
            conversation?.title ?? "Chat",
            request,
        );

        setPendingQuestionnaires((current) => [...current, questionnaire]);

        if (snapshotRef.current.settings.backgroundAgentEnabled) {
            setBackgroundAgentNotificationState("waiting_approval").catch(() => { });
        }

        return await new Promise<PendingQuestionnaireAnswer[] | null>((resolve) => {
            runRegistryRef.current.registerPendingQuestionnaire(
                run.id,
                questionnaire.id,
                resolve,
            );
        });
    }

    async function resolveNotificationApproval(input: {
        approvalId: string;
        decision: import("@/modules/runtime/run-manager").ToolApprovalDecision;
        runId: string;
    }) {
        const approval = pendingToolApprovalsRef.current.find(
            (item) =>
                item.runId === input.runId && item.id === input.approvalId,
        );

        if (!approval) {
            return;
        }

        if (snapshotRef.current.currentConversation?.id !== approval.conversationId) {
            await selectConversation(approval.conversationId);
        }

        resolvePendingToolApproval(approval, input.decision);
    }

    async function requestToolApproval(
        run: AgentRun,
        request: PendingToolApprovalRequest,
    ) {
        if (snapshotRef.current.settings.toolApprovalMode !== "ask") {
            return "approve" satisfies import("@/modules/runtime/run-manager").ToolApprovalDecision;
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

        if (appStateRef.current === "active") {
            if (
                snapshotRef.current.currentConversation?.id !==
                approval.conversationId
            ) {
                setInAppNotification({
                    body: `${approval.toolName}: ${approval.inputSummary}`,
                    conversationId: approval.conversationId,
                    id: `${approval.conversationId}:approval:${approval.id}`,
                    title: `${approval.chatTitle} needs approval`,
                });
            }
        } else if (
            snapshotRef.current.settings.notificationSettings.approvalRequests
        ) {
            notifyApprovalRequestedAsync({
                approvalId: approval.id,
                chatTitle: approval.chatTitle,
                conversationId: approval.conversationId,
                inputSummary: approval.inputSummary,
                runId: approval.runId,
                toolName: approval.toolName,
            }).catch(() => { });
        }

        if (snapshotRef.current.settings.backgroundAgentEnabled) {
            setBackgroundAgentNotificationState("waiting_approval").catch(() => { });
        }

        return await new Promise<
            import("@/modules/runtime/run-manager").ToolApprovalDecision
        >((resolve) => {
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
        status: "success" | "failed";
        title: string;
    }) {
        const currentConversationId =
            snapshotRef.current.currentConversation?.id ?? null;

        if (appStateRef.current === "active") {
            if (currentConversationId !== input.conversationId) {
                setInAppNotification({
                    body: input.body,
                    conversationId: input.conversationId,
                    id: `${input.conversationId}:${Date.now()}`,
                    title: input.title,
                });
            }

            return;
        }

        if (!snapshotRef.current.settings.notificationSettings.runFinished) {
            return;
        }

        await notifyRunFinishedAsync({
            body: input.body,
            conversationId: input.conversationId,
            status: input.status,
            title: input.title,
        });
    }

    const updateRunRecord = useCallback(
        async (
            runId: string,
            input: Parameters<
                typeof repositoriesRef.current.agentRunRepository.update
            >[1],
        ) => {
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
        },
        [],
    );

    async function generateAndApplyConversationTitle(input: {
        conversation: Conversation;
        firstUserMessage: string;
        model: ResolvedModel;
        provider: ProviderConfig;
        runId: string;
    }) {
        const GENERATE_TITLE_PROMPT = `
You are a title generator.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- Never include tool names in the title
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"), return "New chat"
</rules>

<examples>
"write a blog post on x and store in my notion" → Blog for X
"checkout x repo on github" → Explore X Repo
</examples>
`;
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
                system: GENERATE_TITLE_PROMPT,
            });

            title = normalizeGeneratedConversationTitle(result.text, fallback);
        } catch { }

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

    const hydrate = useCallback(async () => {
        const hydrationGeneration = ++hydrationGenerationRef.current;
        setHydrating(true);
        setError(null);

        try {
            const repositories = repositoriesRef.current;

            await repositories.configRepository.ensureDefaultProviders();
            if (!legacyProviderSecretCleanedRef.current) {
                try {
                    await secureSecretStore.deleteProviderApiKey("openai-compatible");
                    legacyProviderSecretCleanedRef.current = true;
                } catch (cleanupError) {
                    console.warn(
                        "Failed to delete the legacy OpenAI-compatible credential.",
                        cleanupError,
                    );
                }
            }

            let settings = await repositories.configRepository.getSettings();
            let conversations = await repositories.conversationRepository.list();

            // Clean up empty "New chat" conversations that were never used
            for (const conv of conversations) {
                if (conv.title !== "New chat") continue;
                const msgs = await repositories.messageRepository.listByConversation(
                    conv.id,
                );
                if (msgs.length > 0) continue;
                if (conv.id === settings.activeConversationId) continue;
                await repositories.conversationRepository.deleteById(conv.id);
            }

            conversations = await repositories.conversationRepository.list();

            if (conversations.length === 0 && !coldStartRef.current) {
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
            const modelPresets =
                await repositories.configRepository.listModelPresets();
            const resolvedConfig = await resolveConfig(
                {
                    providers,
                    modelPresets,
                    settings,
                },
                { discoverRemote: false },
            );

            let currentConversation: Conversation | null;
            if (coldStartRef.current) {
                coldStartRef.current = false;
                const freshConversation =
                    await repositories.conversationRepository.create({
                        title: "New chat",
                        providerId: resolvedConfig.currentModel?.providerId ?? null,
                        modelId: resolvedConfig.currentModel?.modelId ?? null,
                    });
                await repositories.configRepository.setSetting(
                    "active_conversation_id",
                    freshConversation.id,
                );
                conversations = upsertConversation(conversations, freshConversation);
                settings = {
                    ...settings,
                    activeConversationId: freshConversation.id,
                };
                currentConversation = freshConversation;
            } else {
                currentConversation =
                    conversations.find(
                        (conversation) =>
                            conversation.id === settings.activeConversationId,
                    ) ?? null;
            }
            const agentRuns = await repositories.agentRunRepository.list();
            const staleRuns = agentRuns.filter(
                (run) =>
                    (run.status === "running" || run.status === "waiting_for_approval" || run.status === "waiting_for_question" || run.status === "retrying") &&
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
            const savedPrompts = await repositories.savedPromptRepository.list();
            const skills = await repositories.skillRepository.list();
            const workspaceFiles = await repositories.workspaceRepository.list();
            const nextSnapshot = {
                agentRuns: normalizedAgentRuns,
                conversations,
                currentConversation,
                currentSelectedFileIds: currentConversation?.selectedFileIds ?? [],
                currentSelectedMcpServerIds:
                    currentConversation?.selectedMcpServerIds ?? null,
                currentSelectedSkillIds: currentConversation?.selectedSkillIds ?? [],
                memory,
                mcpServers,
                messages,
                savedPrompts,
                skills,
                workspaceFiles,
                resolvedConfig,
                settings,
            } satisfies AppStateSnapshot;

            if (Platform.OS === "android") {
                setProtectedApps(settings.protectedApps).catch((error) => {
                    console.warn(
                        "Failed to sync protected apps to the device automation service.",
                        error,
                    );
                });
            }

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

            void resolveConfig(
                {
                    providers,
                    modelPresets,
                    settings,
                },
                { discoverRemote: true },
            )
                .then(async (discoveredConfig) => {
                    if (hydrationGenerationRef.current !== hydrationGeneration) {
                        return;
                    }

                    const discoveredModelRef = discoveredConfig.currentModel?.ref ?? null;
                    if (discoveredModelRef !== settings.activeModelRef) {
                        await repositories.configRepository.setSetting(
                            "active_model_ref",
                            discoveredModelRef,
                        );
                    }

                    if (hydrationGenerationRef.current !== hydrationGeneration) {
                        return;
                    }

                    setSnapshot((current) => {
                        const discoveredSnapshot = {
                            ...current,
                            resolvedConfig: discoveredConfig,
                            settings: {
                                ...current.settings,
                                activeModelRef: discoveredModelRef,
                            },
                        };
                        snapshotRef.current = discoveredSnapshot;
                        return discoveredSnapshot;
                    });
                })
                .catch((discoveryError) => {
                    console.warn("Failed to refresh model discovery.", discoveryError);
                });
        } catch (hydrateError) {
            setError(
                hydrateError instanceof Error
                    ? hydrateError.message
                    : "Failed to hydrate app state.",
            );
        } finally {
            setHydrating(false);
        }
    }, []);

    const resumePendingRuns = useCallback(async () => {
        const resumableRuns = snapshotRef.current.agentRuns.filter((run) =>
            shouldAutoResumeRun(run.status),
        );

        await Promise.all(
            resumableRuns.map(async (run) => {
                try {
                    await executeAgentRunRef.current(run.id);
                } catch { }
            }),
        );
    }, []);

    useEffect(() => {
        hydrate();
    }, [hydrate]);

    useEffect(() => {
        if (!ready || hydrating) {
            return;
        }

        const alertsEnabled =
            snapshotRef.current.settings.notificationSettings.approvalRequests ||
            snapshotRef.current.settings.notificationSettings.runFinished;

        prepareRunNotificationsAsync({
            requestPermission: alertsEnabled,
        }).catch(() => { });
        dismissStaleApprovalNotificationsAsync(
            pendingToolApprovalsRef.current.map((approval) => ({
                approvalId: approval.id,
                runId: approval.runId,
            })),
        ).catch(() => { });
        dismissRunNotificationsAsync().catch(() => { });
        resumePendingRuns().catch(() => { });
    }, [hydrating, ready, resumePendingRuns]);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            appStateRef.current = nextAppState;

            if (nextAppState === "active") {
                void (async () => {
                    await dismissRunNotificationsAsync();
                    await hydrate();
                    await resumePendingRuns();
                })().catch(() => { });
            }
        });

        return () => {
            subscription.remove();
        };
    }, [hydrate, resumePendingRuns]);

    const refresh = useCallback(async () => {
        await hydrate();
    }, [hydrate]);

    const refreshWorkspaceFiles = useCallback(async () => {
        const workspaceFiles =
            await repositoriesRef.current.workspaceRepository.list();

        setSnapshot((current) => ({
            ...current,
            workspaceFiles,
        }));
    }, []);

    const clearWorkspaceFiles = useCallback(async () => {
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
    }, []);

    const deleteWorkspaceFile = useCallback(async (fileId: string) => {
        const file =
            await repositoriesRef.current.workspaceRepository.getById(fileId);

        if (!file || file.sourceKind === "artifact") {
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
    }, []);

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
        apiKey?: string;
        authType: ProviderConfig["authType"];
        baseUrl?: string | null;
        enabled?: boolean;
        family: ProviderConfig["family"];
        id: string;
        label: string;
        oauthAccountEmail?: string | null;
    }) {
        const provider =
            await repositoriesRef.current.configRepository.createProvider(input);

        try {
            if (input.apiKey) {
                await secureSecretStore.setProviderApiKey(
                    provider.id,
                    input.apiKey.trim(),
                );
            }
        } catch (credentialError) {
            await repositoriesRef.current.configRepository.deleteProvider(provider.id);
            throw credentialError;
        }

        await hydrate();
        return provider;
    }

    async function deleteProvider(providerId: string) {
        if (getSupportedProviderDefinition(providerId)) {
            throw new Error("Built-in providers cannot be deleted.");
        }

        await repositoriesRef.current.configRepository.deleteProvider(providerId);
        try {
            await secureSecretStore.deleteProviderApiKey(providerId);
        } catch (cleanupError) {
            console.warn("Failed to delete the provider credential.", cleanupError);
        } finally {
            await hydrate();
        }
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

    async function createMcpServerOAuth(input: {
        enabled?: boolean;
        label: string;
        oauthAllowedAuthOrigin?: string | null;
        oauthAuthorizationUrl?: string | null;
        oauthClientId?: string | null;
        oauthScopes?: string | null;
        oauthTokenUrl?: string | null;
        transport: McpServerTransport;
        url: string;
    }) {
        const id = Crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const pendingServer: McpServerConfig = {
            authMode: "oauth",
            createdAt: timestamp,
            enabled: input.enabled ?? true,
            headerNames: [],
            id,
            label: input.label,
            lastError: null,
            lastStatus: "untested",
            oauthAllowedAuthOrigin: input.oauthAllowedAuthOrigin ?? null,
            oauthAuthorizationUrl: input.oauthAuthorizationUrl ?? null,
            oauthClientId: input.oauthClientId ?? null,
            oauthScopes: input.oauthScopes ?? null,
            oauthTokenUrl: input.oauthTokenUrl ?? null,
            serverInfo: null,
            serverInstructions: null,
            toolCount: null,
            transport: input.transport,
            updatedAt: timestamp,
            url: input.url,
        };

        try {
            await connectMcpOAuth(pendingServer);
            const server =
                await repositoriesRef.current.mcpServerRepository.create({
                    authMode: "oauth",
                    enabled: pendingServer.enabled,
                    headerNames: [],
                    id,
                    label: pendingServer.label,
                    oauthAllowedAuthOrigin: pendingServer.oauthAllowedAuthOrigin,
                    oauthAuthorizationUrl: pendingServer.oauthAuthorizationUrl,
                    oauthClientId: pendingServer.oauthClientId,
                    oauthScopes: pendingServer.oauthScopes,
                    oauthTokenUrl: pendingServer.oauthTokenUrl,
                    transport: pendingServer.transport,
                    url: pendingServer.url,
                });
            await hydrate();
            return server;
        } catch (error) {
            try {
                await secureSecretStore.deleteMcpOAuthTokens(id);
            } catch (cleanupError) {
                console.error("Could not clear pending MCP OAuth setup.", cleanupError);
            }
            throw error;
        }
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

    async function importSkillMarkdown(input: {
        markdown: string;
        replaceById?: string | null;
    }) {
        const parsed = parseSkillMarkdown(input.markdown);
        let skill: SkillConfig;

        if (input.replaceById) {
            await repositoriesRef.current.skillRepository.update(input.replaceById, {
                autoMatch: parsed.autoMatch,
                description: parsed.description,
                enabled: true,
                instructions: parsed.instructions,
                matchKeywords: parsed.matchKeywords,
                recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
                recommendedMcpServerIds: parsed.recommendedMcpServerIds,
                title: parsed.title,
            });
            const replaced = await repositoriesRef.current.skillRepository.getById(
                input.replaceById,
            );

            if (!replaced) {
                throw new Error(`Skill not found: ${input.replaceById}`);
            }

            skill = replaced;
        } else {
            skill = await repositoriesRef.current.skillRepository.create({
                autoMatch: parsed.autoMatch,
                description: parsed.description,
                enabled: true,
                instructions: parsed.instructions,
                matchKeywords: parsed.matchKeywords,
                recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
                recommendedMcpServerIds: parsed.recommendedMcpServerIds,
                title: parsed.title,
            });
        }

        await hydrate();
        return skill;
    }

    function exportSkillMarkdown(skillId: string) {
        const skill = snapshotRef.current.skills.find((item) => item.id === skillId);

        if (!skill) {
            throw new Error(`Skill not found: ${skillId}`);
        }

        return serializeSkillToMarkdown(skill);
    }

    async function createSavedPrompt(input: {
        content: string;
        title: string;
    }) {
        const savedPrompt =
            await repositoriesRef.current.savedPromptRepository.create(input);
        await hydrate();
        return savedPrompt;
    }

    async function updateSavedPrompt(
        savedPromptId: string,
        input: {
            content?: string;
            title?: string;
        },
    ) {
        await repositoriesRef.current.savedPromptRepository.update(
            savedPromptId,
            input,
        );
        await hydrate();
    }

    async function deleteSavedPrompt(savedPromptId: string) {
        await repositoriesRef.current.savedPromptRepository.delete(savedPromptId);
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

    const updateProtectedApps = useCallback(async (packageNames: string[]) => {
        await repositoriesRef.current.configRepository.setProtectedApps(
            packageNames,
        );
        if (Platform.OS === "android") {
            setProtectedApps(packageNames).catch((error) => {
                console.warn(
                    "Failed to sync protected apps to the device automation service.",
                    error,
                );
            });
        }
        await hydrate();
    }, [hydrate]);

    const updateToolApprovalMode = useCallback(
        async (mode: AppSettings["toolApprovalMode"]) => {
            await repositoriesRef.current.configRepository.setToolApprovalMode(mode);
            await hydrate();
        },
        [hydrate],
    );

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

    async function updateBackgroundAgentEnabled(enabled: boolean) {
        await repositoriesRef.current.configRepository.setBackgroundAgentEnabled(enabled);
        await hydrate();
    }

    async function updateNotificationSettings(
        input: Partial<AppSettings["notificationSettings"]>,
    ) {
        await repositoriesRef.current.configRepository.setNotificationSettings(
            input,
        );
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
        } catch { }
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
        await hydrate().catch(() => { });
    }

    async function disconnectOpenAIOAuth() {
        await clearOpenAiTokens();
        setOpenAIOAuthEmailInSnapshot(null);
        await persistOpenAIOAuthEmail(null);
        await hydrate().catch(() => { });
    }

    const createConversation = useCallback(async () => {
        const currentModel = snapshotRef.current.resolvedConfig.currentModel;
        const now = new Date().toISOString();
        const conversation: Conversation = {
            archivedAt: null,
            createdAt: now,
            externalFolderSession: null,
            id: Crypto.randomUUID(),
            modelId: currentModel?.modelId ?? null,
            pinnedAt: null,
            providerId: currentModel?.providerId ?? null,
            reasoningEffort: "medium",
            agentMode: "build",
            selectedFileIds: [],
            selectedMcpServerIds: null,
            selectedSkillIds: [],
            title: "New chat",
            updatedAt: now,
        };

        const saved = await repositoriesRef.current.conversationRepository.create({
            id: conversation.id,
            title: conversation.title,
            providerId: conversation.providerId,
            modelId: conversation.modelId,
        });
        await repositoriesRef.current.configRepository.setSetting(
            "active_conversation_id",
            saved.id,
        );

        setSnapshot((current) => ({
            ...current,
            conversations: upsertConversation(current.conversations, saved),
            currentConversation: conversation,
            currentSelectedFileIds: [],
            currentSelectedMcpServerIds: null,
            currentSelectedSkillIds: [],
            messages: [],
            settings: {
                ...current.settings,
                activeConversationId: conversation.id,
            },
        }));
    }, []);

    async function deleteConversation(conversationId: string) {
        await repositoriesRef.current.conversationRepository.deleteById(
            conversationId,
        );
        await hydrate();
    }

    async function setConversationPinned(
        conversationId: string,
        pinned: boolean,
    ) {
        const conversation = snapshotRef.current.conversations.find(
            (item) => item.id === conversationId,
        );

        if (!conversation || Boolean(conversation.pinnedAt) === pinned) {
            return;
        }

        if (
            pinned &&
            snapshotRef.current.conversations.filter((item) => item.pinnedAt)
                .length >= 3
        ) {
            throw new Error("You can pin up to 3 chats.");
        }

        const updatedConversation = {
            ...conversation,
            pinnedAt: pinned ? new Date().toISOString() : null,
        };
        await repositoriesRef.current.conversationRepository.updateMetadata(
            conversationId,
            {
                pinnedAt: updatedConversation.pinnedAt,
                updatedAt: conversation.updatedAt,
            },
        );

        setSnapshot((current) => {
            const nextSnapshot = {
                ...current,
                conversations: upsertConversation(
                    current.conversations,
                    updatedConversation,
                ),
                currentConversation:
                    current.currentConversation?.id === conversationId
                        ? updatedConversation
                        : current.currentConversation,
            };
            snapshotRef.current = nextSnapshot;
            return nextSnapshot;
        });
    }

    async function renameConversation(conversationId: string, title: string) {
        const conversation = snapshotRef.current.conversations.find(
            (item) => item.id === conversationId,
        );
        const nextTitle = title.replace(/\s+/g, " ").trim();

        if (!conversation) {
            return;
        }

        if (!nextTitle) {
            throw new Error("Chat title cannot be empty.");
        }

        if (conversation.title === nextTitle) {
            return;
        }

        const updatedConversation = {
            ...conversation,
            title: nextTitle,
        };
        await repositoriesRef.current.conversationRepository.updateMetadata(
            conversationId,
            {
                title: nextTitle,
                updatedAt: conversation.updatedAt,
            },
        );

        setSnapshot((current) => {
            const nextSnapshot = {
                ...current,
                conversations: upsertConversation(
                    current.conversations,
                    updatedConversation,
                ),
                currentConversation:
                    current.currentConversation?.id === conversationId
                        ? updatedConversation
                        : current.currentConversation,
            };
            snapshotRef.current = nextSnapshot;
            return nextSnapshot;
        });
    }

    const importFiles = useCallback(async (assets: DocumentPickerAsset[]) => {
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
    }, [refreshWorkspaceFiles]);

    async function createWorkspaceFile(input: { content: string; name: string }) {
        const file = await workspaceServiceRef.current.createTextFile(input);

        setSnapshot((current) => ({
            ...current,
            workspaceFiles: upsertWorkspaceFiles(current.workspaceFiles, [file]),
        }));

        await refreshWorkspaceFiles();
        return file;
    }

    const pickConversationFolder = useCallback(async () => {
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
    }, []);

    const clearConversationFolder = useCallback(async () => {
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
    }, []);

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
            currentSelectedMcpServerIds: nextConversation.selectedMcpServerIds,
            currentSelectedSkillIds: nextConversation.selectedSkillIds,
            messages,
            settings: {
                ...current.settings,
                activeConversationId: conversationId,
            },
        }));
    }

    const ensureConversationPersisted = useCallback(
        async (conversation: Conversation) => {
            const repositories = repositoriesRef.current;
            const exists = await repositories.conversationRepository.getById(
                conversation.id,
            );
            if (exists) return;

            const saved = await repositories.conversationRepository.create({
                id: conversation.id,
                title: conversation.title,
                providerId: conversation.providerId,
                modelId: conversation.modelId,
            });

            await repositories.configRepository.setSetting(
                "active_conversation_id",
                saved.id,
            );

            setSnapshot((current) => ({
                ...current,
                conversations: upsertConversation(current.conversations, saved),
                settings: {
                    ...current.settings,
                    activeConversationId: saved.id,
                },
            }));
        },
        [],
    );

    const setCurrentSelectedFileIds = useCallback(
        async (selectedFileIds: string[]) => {
            const repositories = repositoriesRef.current;
            const currentConversation = snapshotRef.current.currentConversation;

            if (!currentConversation) {
                return;
            }

            await ensureConversationPersisted(currentConversation);

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
        },
        [ensureConversationPersisted],
    );

    const setCurrentSelectedSkillIds = useCallback(
        async (selectedSkillIds: string[]) => {
            const repositories = repositoriesRef.current;
            const currentConversation = snapshotRef.current.currentConversation;

            if (!currentConversation) {
                return;
            }

            await ensureConversationPersisted(currentConversation);

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
        },
        [ensureConversationPersisted],
    );

    const setCurrentSelectedMcpServerIds = useCallback(
        async (selectedMcpServerIds: string[] | null) => {
            const repositories = repositoriesRef.current;
            const currentConversation = snapshotRef.current.currentConversation;

            if (!currentConversation) {
                return;
            }

            await ensureConversationPersisted(currentConversation);

            const existingServerIds = new Set(
                snapshotRef.current.mcpServers.map((server) => server.id),
            );
            const nextSelectedMcpServerIds =
                selectedMcpServerIds === null
                    ? null
                    : Array.from(
                          new Set(
                              selectedMcpServerIds.filter((serverId) =>
                                  existingServerIds.has(serverId),
                              ),
                          ),
                      );
            const updatedConversation: Conversation = {
                ...currentConversation,
                selectedMcpServerIds: nextSelectedMcpServerIds,
                updatedAt: currentConversation.updatedAt,
            };

            await repositories.conversationRepository.updateMetadata(
                currentConversation.id,
                {
                    selectedMcpServerIds: nextSelectedMcpServerIds,
                },
            );

            setSnapshot((current) => ({
                ...current,
                conversations: current.conversations.map((conversation) =>
                    conversation.id === currentConversation.id
                        ? {
                            ...conversation,
                            selectedMcpServerIds: nextSelectedMcpServerIds,
                        }
                        : conversation,
                ),
                currentConversation: updatedConversation,
                currentSelectedMcpServerIds: nextSelectedMcpServerIds,
            }));
        },
        [ensureConversationPersisted],
    );

    const setReasoningEffort = useCallback(
        async (effort: ReasoningEffort) => {
            const currentConversation = snapshotRef.current.currentConversation;

            if (!currentConversation) {
                return;
            }

            await ensureConversationPersisted(currentConversation);

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
        },
        [ensureConversationPersisted],
    );

    const setAgentMode = useCallback(
        async (mode: AgentMode) => {
            const currentConversation = snapshotRef.current.currentConversation;

            if (!currentConversation) {
                return;
            }

            await ensureConversationPersisted(currentConversation);

            await repositoriesRef.current.conversationRepository.updateMetadata(
                currentConversation.id,
                { agentMode: mode },
            );

            setSnapshot((current) => ({
                ...current,
                conversations: current.conversations.map((conversation) =>
                    conversation.id === currentConversation.id
                        ? { ...conversation, agentMode: mode }
                        : conversation,
                ),
                currentConversation:
                    current.currentConversation?.id === currentConversation.id
                        ? { ...current.currentConversation, agentMode: mode }
                        : current.currentConversation,
            }));
        },
        [ensureConversationPersisted],
    );

    const selectModel = useCallback(
        async (modelRef: ModelRef) => {
            await repositoriesRef.current.configRepository.setSetting(
                "active_model_ref",
                modelRef,
            );
            await hydrate();
        },
        [hydrate],
    );

    async function executeAgentRun(runId: string) {
        if (!runRegistryRef.current.claim(runId)) {
            return;
        }

        try {
            const ui = createRunUiPublisher({
                runId,
                setError,
                setPendingToolApprovals,
                setSnapshot,
            });
            const deps: AgentRunDeps = {
                repositories: repositoriesRef.current,
                snapshotRef,
                runRegistry: runRegistryRef.current,
                workspaceService: workspaceServiceRef.current,
                updateRunRecord,
                requestToolApproval,
                requestRunQuestionnaire,
                generateAndApplyConversationTitle,
                notifyRunStateChange,
                ui,
                onSkillsChange: () => {
                    hydrate().catch(() => {});
                },
                retryRun: (retryRunId, delayMs) => {
                    setTimeout(() => {
                        executeAgentRun(retryRunId).catch(() => {});
                    }, delayMs);
                },
            };

            await executeClaimedAgentRun(runId, deps);
        } catch (error) {
            runRegistryRef.current.clear(runId);
            throw error;
        }
    }
    executeAgentRunRef.current = executeAgentRun;

    async function retryRun(runId: string) {
        const run = snapshotRef.current.agentRuns.find((r) => r.id === runId);
        if (!run || (run.status !== "failed" && run.status !== "canceled")) {
            return;
        }

        await repositoriesRef.current.agentRunRepository.update(runId, {
            completedAt: null,
            lastError: null,
            status: "resumable",
            retryCount: 0,
        });

        await repositoriesRef.current.messageRepository.updateContent({
            id: run.assistantMessageId,
            content: "",
            error: null,
            status: "streaming",
        });

        setSnapshot((current) => ({
            ...current,
            agentRuns: upsertAgentRun(current.agentRuns, {
                ...run,
                completedAt: null,
                lastError: null,
                retryCount: 0,
                status: "resumable",
            }),
            messages: current.currentConversation?.id === run.conversationId
                ? upsertMessages(current.messages, [{
                    ...current.messages.find((m) => m.id === run.assistantMessageId)!,
                    content: "",
                    error: null,
                    status: "streaming",
                }])
                : current.messages,
        }));

        await executeAgentRun(runId);
    }

    const editAndResendMessage = useCallback(async (messageId: string, content: string) => {
        const cleanContent = content.trim();
        const current = snapshotRef.current;
        const message = current.messages.find((item) => item.id === messageId);

        if (!cleanContent) {
            throw new Error("Message cannot be empty.");
        }

        if (!message || message.role !== "user") {
            throw new Error("Message not found.");
        }

        const latestUserMessage = [...current.messages]
            .reverse()
            .find((item) => item.role === "user");

        if (latestUserMessage?.id !== messageId) {
            throw new Error("Only the latest message can be edited.");
        }

        const run = current.agentRuns.find(
            (item) => item.userMessageId === messageId,
        );

        if (!run) {
            throw new Error("The response for this message cannot be regenerated.");
        }

        if (isActiveAgentRunStatus(run.status)) {
            throw new Error("Wait for the current response to finish first.");
        }

        const assistantMessage = current.messages.find(
            (item) => item.id === run.assistantMessageId,
        );

        if (!assistantMessage) {
            throw new Error("Assistant response not found.");
        }

        const timestamp = new Date().toISOString();
        const model = current.resolvedConfig.availableModels.find(
            (item) =>
                item.providerId === run.providerId && item.modelId === run.modelId,
        );
        const assistantMetadata = buildAssistantMetadata({
            appliedSkillIds: message.metadata?.appliedSkillIds,
            executionTimeline: [
                createExecutionTimelineEvent({
                    createdAt: timestamp,
                    detail: model
                        ? `${model.providerLabel} · ${model.label}`
                        : `${run.providerId} · ${run.modelId}`,
                    kind: "run",
                    status: "pending",
                    title: "Run queued",
                }),
            ],
            runId: run.id,
            toolExecutions: [],
        });
        const updatedUserMessage: StoredMessage = {
            ...message,
            content: cleanContent,
            error: null,
            status: "completed",
            updatedAt: timestamp,
        };
        const updatedAssistantMessage: StoredMessage = {
            ...assistantMessage,
            content: "",
            error: null,
            metadata: assistantMetadata,
            status: "streaming",
            updatedAt: timestamp,
        };
        const updatedRun: AgentRun = {
            ...run,
            completedAt: null,
            input: cleanContent,
            lastError: null,
            lastRetryAt: null,
            retryCount: 0,
            startedAt: timestamp,
            status: "resumable",
            updatedAt: timestamp,
        };

        await repositoriesRef.current.messageRepository.updateContent({
            id: message.id,
            content: cleanContent,
            error: null,
            status: "completed",
        });
        await repositoriesRef.current.messageRepository.updateContent({
            id: assistantMessage.id,
            content: "",
            error: null,
            metadata: assistantMetadata,
            status: "streaming",
        });
        await repositoriesRef.current.agentRunRepository.update(run.id, {
            completedAt: null,
            input: cleanContent,
            lastError: null,
            lastRetryAt: null,
            retryCount: 0,
            startedAt: timestamp,
            status: "resumable",
            updatedAt: timestamp,
        });

        const nextSnapshot = {
            ...snapshotRef.current,
            agentRuns: upsertAgentRun(snapshotRef.current.agentRuns, updatedRun),
            messages: upsertMessages(snapshotRef.current.messages, [
                updatedUserMessage,
                updatedAssistantMessage,
            ]),
        };
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);

            void executeAgentRunRef.current(run.id).catch((runError) => {
                setError(
                    runError instanceof Error
                        ? runError.message
                        : "Failed to restart run.",
                );
            });
    }, []);

    const cancelRun = useCallback(async (input?: {
        conversationId?: string;
        runId?: string;
    }) => {
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

        runRegistryRef.current.stopRun(targetRun.id);

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
    }, [updateRunRecord]);

    const stopSending = useCallback(async () => {
        await cancelRun({
            conversationId: snapshotRef.current.currentConversation?.id,
        });
    }, [cancelRun]);

    const sendMessage = useCallback(async (input: SendMessageInput) => {
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
        prepareRunNotificationsAsync({
            requestPermission:
                snapshotRef.current.settings.notificationSettings
                    .approvalRequests ||
                snapshotRef.current.settings.notificationSettings.runFinished,
        }).catch(() => { });

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
            selectedFileIds: [],
            selectedSkillIds: conversation.selectedSkillIds,
            updatedAt: timestamp,
        };

        const appliedSkills = resolveAppliedSkills({
            content: cleanContent,
            selectedSkillIds: conversation.selectedSkillIds,
            skills: snapshotRef.current.skills,
        });
        const appliedSkillIds = appliedSkills.map((skill) => skill.id);
        const userMetadataEntries: import("@/core/types/app-state").MessageMetadata = {};

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

        const userMetadata: import("@/core/types/app-state").MessageMetadata | null =
            Object.keys(userMetadataEntries).length > 0 ? userMetadataEntries : null;
        const userMessageId = Crypto.randomUUID();
        const assistantMessageId = Crypto.randomUUID();
        const agentRunId = Crypto.randomUUID();

        const optimisticUserMessage: StoredMessage = {
            conversationId: conversation.id,
            content: cleanContent,
            createdAt: timestamp,
            error: null,
            id: userMessageId,
            metadata: userMetadata,
            role: "user",
            sequence: userSequence,
            status: "completed",
            updatedAt: timestamp,
        };
        const optimisticAssistantMetadata = buildAssistantMetadata({
            appliedSkillIds,
            executionTimeline: [
                createExecutionTimelineEvent({
                    detail: `${model.providerLabel} · ${model.label}`,
                    kind: "run",
                    status: "pending",
                    title: "Run queued",
                    createdAt: timestamp,
                }),
            ],
            runId: agentRunId,
            toolExecutions: [],
        });
        const optimisticAssistantMessage: StoredMessage = {
            conversationId: conversation.id,
            content: "",
            createdAt: timestamp,
            error: null,
            id: assistantMessageId,
            metadata: optimisticAssistantMetadata,
            role: "assistant",
            sequence: assistantSequence,
            status: "streaming",
            updatedAt: timestamp,
        };
        const optimisticAgentRun: AgentRun = {
            agentMode: conversation.agentMode,
            assistantMessageId,
            completedAt: null,
            conversationId: conversation.id,
            externalFolderSession,
            fileContextSource,
            id: agentRunId,
            input: cleanContent,
            lastError: null,
            lastRetryAt: null,
            maxRetries: 3,
            modelId: model.modelId,
            providerId: model.providerId,
            resumeCount: 0,
            retryCount: 0,
            selectedFileIds,
            startedAt: timestamp,
            status: "queued",
            updatedAt: timestamp,
            userMessageId,
        };

        const patchLiveMessages = (
            current: AppStateSnapshot,
            nextMessages: StoredMessage[],
            nextAgentRun: AgentRun,
            nextConversation: Conversation,
        ) => {
            logMessageDebug("send-before-live-patch", {
                conversationId: conversation.id,
                currentConversationId: current.currentConversation?.id ?? null,
                shouldPatchMessages:
                    current.currentConversation?.id === conversation.id,
                currentMessages: buildMessageDebugSummary(current.messages),
                nextAssistantId: assistantMessageId,
                nextUserId: userMessageId,
            });

            return {
                ...current,
                agentRuns: upsertAgentRun(current.agentRuns, nextAgentRun),
                conversations: upsertConversation(
                    current.conversations,
                    nextConversation,
                ),
                currentConversation:
                    current.currentConversation?.id === nextConversation.id
                        ? nextConversation
                        : current.currentConversation,
                currentSelectedFileIds:
                    current.currentConversation?.id === conversation.id
                        ? []
                        : current.currentSelectedFileIds,
                currentSelectedMcpServerIds:
                    current.currentConversation?.id === conversation.id
                        ? conversation.selectedMcpServerIds
                        : current.currentSelectedMcpServerIds,
                currentSelectedSkillIds:
                    current.currentConversation?.id === conversation.id
                        ? conversation.selectedSkillIds
                        : current.currentSelectedSkillIds,
                messages:
                    current.currentConversation?.id === conversation.id
                        ? upsertMessages(current.messages, nextMessages)
                        : current.messages,
            };
        };

        setSnapshot((current) =>
            patchLiveMessages(
                current,
                [optimisticUserMessage, optimisticAssistantMessage],
                optimisticAgentRun,
                updatedConversation,
            ),
        );

        let agentRun: AgentRun;
        let userMessage: StoredMessage;
        let assistantMessage: StoredMessage;
        let assistantMetadata: import("@/core/types/app-state").MessageMetadata | null;

        try {
            await ensureConversationPersisted(conversation);

            await repositories.conversationRepository.updateMetadata(conversation.id, {
                title: nextTitle,
                providerId: model.providerId,
                modelId: model.modelId,
                selectedFileIds: [],
                updatedAt: timestamp,
            });

            userMessage = await repositories.messageRepository.create({
                conversationId: conversation.id,
                content: cleanContent,
                id: userMessageId,
                metadata: userMetadata,
                role: "user",
                sequence: userSequence,
                status: "completed",
            });
            assistantMessage = await repositories.messageRepository.create({
                conversationId: conversation.id,
                content: "",
                id: assistantMessageId,
                metadata: null,
                role: "assistant",
                sequence: assistantSequence,
                status: "streaming",
            });
            agentRun = await repositories.agentRunRepository.create({
                agentMode: conversation.agentMode,
                assistantMessageId: assistantMessage.id,
                conversationId: conversation.id,
                externalFolderSession,
                fileContextSource,
                id: agentRunId,
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
            assistantMetadata = buildAssistantMetadata({
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
        } catch (error) {
            setSnapshot((current) => ({
                ...current,
                agentRuns: current.agentRuns.filter(
                    (run) => run.id !== agentRunId,
                ),
                messages: current.messages.filter(
                    (message) =>
                        message.id !== userMessageId &&
                        message.id !== assistantMessageId,
                ),
            }));
            throw error;
        }

        setSnapshot((current) =>
            patchLiveMessages(
                current,
                [userMessage, { ...assistantMessage, metadata: assistantMetadata }],
                agentRun,
                updatedConversation,
            ),
        );

        void executeAgentRunRef.current(agentRun.id).catch((runError) => {
            setError(
                runError instanceof Error ? runError.message : "Failed to start run.",
            );
        });
    }, [ensureConversationPersisted]);

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
    const pendingQuestionnaire =
        pendingQuestionnaires.find(
            (questionnaire) =>
                questionnaire.conversationId ===
                snapshot.currentConversation?.id,
        ) ?? null;

    return (
        <AppStateContext.Provider
            value={{
                resolveNotificationApproval,
                updateNotificationSettings,
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
                createMcpServerOAuth,
                writeMemory,
                createProvider,
                createConversation,
                deleteProvider,
                deleteConversation,
                createModelPreset,
                createSavedPrompt,
                createSkill,
                createWorkspaceFile,
                currentConversation: snapshot.currentConversation,
                currentExternalFolderSession:
                    snapshot.currentConversation?.externalFolderSession ?? null,
                currentSelectedFileIds: snapshot.currentSelectedFileIds,
                currentSelectedMcpServerIds: snapshot.currentSelectedMcpServerIds,
                currentSelectedSkillIds: snapshot.currentSelectedSkillIds,
                dismissInAppNotification,
                pendingToolApproval,
                denyPendingToolApproval: () => {
                    if (pendingToolApproval) {
                        resolvePendingToolApproval(pendingToolApproval, "deny");
                    }
                },
                pendingQuestionnaire,
                submitPendingQuestionnaire: (answers) => {
                    if (pendingQuestionnaire) {
                        resolvePendingQuestionnaire(
                            pendingQuestionnaire,
                            answers,
                        );
                    }
                },
                dismissPendingQuestionnaire: () => {
                    if (pendingQuestionnaire) {
                        resolvePendingQuestionnaire(pendingQuestionnaire, null);
                    }
                },
                deleteMcpServer,
                clearMemory,
                deleteModelPreset,
                deleteSavedPrompt,
                deleteSkill,
                deleteWorkspaceFile,
                disconnectOpenAIOAuth,
                error,
                hydrating,
                importFiles,
                inAppNotification,
                importSkillMarkdown,
                exportSkillMarkdown,
                messages: snapshot.messages,
                editAndResendMessage,
                savedPrompts: snapshot.savedPrompts,
                memory: snapshot.memory,
                mcpServers: snapshot.mcpServers,
                pickConversationFolder,
                ready,
                refresh,
                refreshWorkspaceFiles,
                renameConversation,
                resumePendingRuns,
                retryRun,
                resolvedConfig: snapshot.resolvedConfig,
                runStatusByConversation,
                saveProviderApiKey,
                saveMcpServerHeaderValues,
                selectConversation,
                setConversationPinned,
                selectModel,
                sendMessage,
                sending,
                stopSending,
                reasoningEffort:
                    snapshot.currentConversation?.reasoningEffort ?? "medium",
                setReasoningEffort,
                agentMode:
                    snapshot.currentConversation?.agentMode ?? "build",
                setAgentMode,
                setCurrentSelectedFileIds,
                setCurrentSelectedMcpServerIds,
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
                updateProtectedApps,
                updateSavedPrompt,
                updateSkill,
                updateToolApprovalMode,
                updateThemeMode,
                updateBackgroundAgentEnabled,
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
        createMcpServerOAuth: context.createMcpServerOAuth,
        writeMemory: context.writeMemory,
        createProvider: context.createProvider,
        createModelPreset: context.createModelPreset,
        createSavedPrompt: context.createSavedPrompt,
        createSkill: context.createSkill,
        importSkillMarkdown: context.importSkillMarkdown,
        exportSkillMarkdown: context.exportSkillMarkdown,
        createWorkspaceFile: context.createWorkspaceFile,
        deleteMcpServer: context.deleteMcpServer,
        deleteProvider: context.deleteProvider,
        clearMemory: context.clearMemory,
        deleteModelPreset: context.deleteModelPreset,
        deleteSavedPrompt: context.deleteSavedPrompt,
        deleteSkill: context.deleteSkill,
        deleteWorkspaceFile: context.deleteWorkspaceFile,
        disconnectOpenAIOAuth: context.disconnectOpenAIOAuth,
        currentSelectedMcpServerIds: context.currentSelectedMcpServerIds,
        setCurrentSelectedMcpServerIds: context.setCurrentSelectedMcpServerIds,
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
        savedPrompts: context.savedPrompts,
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
        updateProtectedApps: context.updateProtectedApps,
        protectedApps: context.settings.protectedApps,
        updateSavedPrompt: context.updateSavedPrompt,
        updateSkill: context.updateSkill,
        updateToolApprovalMode: context.updateToolApprovalMode,
        updateThemeMode: context.updateThemeMode,
        updateBackgroundAgentEnabled: context.updateBackgroundAgentEnabled,
        backgroundAgentEnabled: context.settings.backgroundAgentEnabled,
        notificationSettings: context.settings.notificationSettings,
        updateNotificationSettings: context.updateNotificationSettings,
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
        currentSelectedMcpServerIds: context.currentSelectedMcpServerIds,
        currentSelectedSkillIds: context.currentSelectedSkillIds,
        pendingToolApproval: context.pendingToolApproval,
        approvePendingToolApproval: context.approvePendingToolApproval,
        denyPendingToolApproval: context.denyPendingToolApproval,
        pendingQuestionnaire: context.pendingQuestionnaire,
        submitPendingQuestionnaire: context.submitPendingQuestionnaire,
        dismissPendingQuestionnaire: context.dismissPendingQuestionnaire,
        resolveNotificationApproval: context.resolveNotificationApproval,
        createConversation: context.createConversation,
        createSavedPrompt: context.createSavedPrompt,
        createWorkspaceFile: context.createWorkspaceFile,
        clearConversationFolder: context.clearConversationFolder,
        clearWorkspaceFiles: context.clearWorkspaceFiles,
        deleteWorkspaceFile: context.deleteWorkspaceFile,
        currentSelectedFileIds: context.currentSelectedFileIds,
        importFiles: context.importFiles,
        messages: context.messages,
        editAndResendMessage: context.editAndResendMessage,
        savedPrompts: context.savedPrompts,
        pickConversationFolder: context.pickConversationFolder,
        resumePendingRuns: context.resumePendingRuns,
        retryRun: context.retryRun,
        renameConversation: context.renameConversation,
        runStatusByConversation: context.runStatusByConversation,
        selectConversation: context.selectConversation,
        setConversationPinned: context.setConversationPinned,
        sendMessage: context.sendMessage,
        skills: context.skills,
        updateSavedPrompt: context.updateSavedPrompt,
        deleteSavedPrompt: context.deleteSavedPrompt,
        sending:
            currentConversationRunStatus === "queued" ||
            currentConversationRunStatus === "running" ||
            currentConversationRunStatus === "waiting_for_approval" ||
            currentConversationRunStatus === "waiting_for_question" ||
            currentConversationRunStatus === "resumable" ||
            currentConversationRunStatus === "retrying",
        stopSending: context.stopSending,
        reasoningEffort: context.reasoningEffort,
        setReasoningEffort: context.setReasoningEffort,
        agentMode: context.agentMode,
        setAgentMode: context.setAgentMode,
        setCurrentSelectedFileIds: context.setCurrentSelectedFileIds,
        setCurrentSelectedMcpServerIds: context.setCurrentSelectedMcpServerIds,
        setCurrentSelectedSkillIds: context.setCurrentSelectedSkillIds,
        refreshWorkspaceFiles: context.refreshWorkspaceFiles,
        workspaceFiles: context.workspaceFiles,
        deleteConversation: context.deleteConversation,
    };
}
