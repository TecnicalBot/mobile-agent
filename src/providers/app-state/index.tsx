import type { DocumentPickerAsset } from "expo-document-picker";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { useSQLiteContext } from "expo-sqlite";
import { colorScheme } from "nativewind";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    AppState,
    Platform,
    useColorScheme as useSystemColorScheme,
} from "react-native";

import {
    createRepositories,
    type Repositories,
} from "@/core/db/database";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { connectMcpOAuth } from "@/modules/mcp/oauth";
import { revokeProxySession } from "@/modules/mcp/proxy";
import { testMcpServerConnection } from "@/modules/mcp/runtime-tools";
import {
    dismissApprovalNotification,
    dismissQuestionNotification,
    dismissRunNotificationsAsync,
    dismissSecretNotification,
    dismissStaleApprovalNotificationsAsync,
    notifyApprovalRequestedAsync,
    notifyQuestionRequestedAsync,
    notifyRunFinishedAsync,
    notifySecretRequestedAsync,
    prepareRunNotificationsAsync,
} from "@/modules/notifications/run-notifications";
import { announceAsync } from "@/modules/notifications/announcements";
import {
    setBackgroundAgentNotificationState,
    stopBackgroundAgent,
} from "background-agent-service";
import {
    clearOpenAiTokens,
    clearOpenAiTokensForAccount,
    getOpenAiTokenInfo,
    getOpenAiTokenInfoForAccount,
    handleLogin,
} from "@/modules/providers/openai-oauth";
import {
    clearLegacyOpenAiChatGptTokens,
    clearOpenAiChatGptTokensForAccount,
    getOpenAiChatGptTokenInfo,
    getOpenAiChatGptTokenInfoForAccount,
    handleChatGptLogin,
} from "@/modules/providers/openai-chatgpt-oauth";
import { getOpenAiOAuthFlavor } from "@/modules/providers/openai";
import { getSupportedProviderDefinition } from "@/modules/providers";
import {
  isAudioMimeType,
  isVideoMimeType,
  partitionSelectedFiles,
} from "@/modules/runtime/message-conversion";
import { modelRuntime } from "@/modules/runtime/model-runtime";
import { createExecutionTimelineEvent } from "@/modules/runtime/run-artifacts";
import {
    buildRunStatusByConversation,
    createPendingQuestionnaire,
    createPendingSecretRequest,
    createPendingToolApproval,
    createRunControllerRegistry,
    isActiveAgentRunStatus,
    shouldAutoResumeRun,
} from "@/modules/runtime/run-manager";
import { secureSecretStore } from "@/core/services/secrets";
import { createPluginRuntime } from "@/modules/plugins/plugin-runtime";
import { importPluginSource } from "@/modules/plugins/import";
import { checkPluginUpdates } from "@/modules/plugins/updater";
import type {
    PluginActionInfo,
    PluginRuntimeSnapshot,
    PluginToolInfo,
} from "@/modules/plugins/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { File } from "expo-file-system";
import {
    parseSkillMarkdown,
    serializeSkillToMarkdown,
} from "@/modules/skills/skill-markdown";
import {
    fetchSkillFiles,
    SKILL_FILE_MAX_COUNT,
    SKILL_FILE_MAX_TOTAL_BYTES,
} from "@/modules/skills/skill-files";
import {
    DEFAULT_CATALOG_SEED_VERSION,
    DEFAULT_CATALOG_SEED_VERSION_KEY,
    seedDefaultEntries,
} from "@/modules/defaults/default-entries";
import {
    isNativeAgentId,
    resolveConversationAgent,
} from "@/modules/agents/registry";
import { isPlanAgent } from "@/modules/agents/permissions";
import {
    normalizeAgentName,
    parseAgentMarkdown,
    serializeAgentToMarkdown,
} from "@/modules/agents/agent-markdown";
import {
    parseConversationExport,
    serializeConversationExport,
} from "@/modules/content/chat-export";
import type {
    AgentConfig,
    AgentRun,
    AppSettings,
    AppStateSnapshot,
    BuiltInToolSettings,
    Conversation,
    ExternalFolderSession,
    FileContextSource,
    McpServerAuthMode,
    McpServerConfig,
    McpServerOAuthMode,
    McpServerTransport,
    MemoryEntry,
    ModelRef,
    PendingInput,
    PendingInputDelivery,
    PendingQuestionnaire,
    PendingQuestionnaireAnswer,
    PendingSecretRequest,
    PendingSecretRequestAnswer,
    PendingSecretRequestRequest,
    ToolApprovalMode,
    PendingToolApproval,
    PendingToolApprovalRequest,
    ProviderAccount,
    ProviderConfig,
    PluginConfig,
    ReasoningEffort,
    ResolvedConfig,
    ResolvedModel,
    SavedPrompt,
    Schedule,
    SendMessageInput,
    SkillConfig,
    StoredMessage,
    WorkspaceFile,
} from "@/core/types/app-state";
import { createModelRef } from "@/core/types/app-state";
import {
    computeNextRun,
    createSchedulerEngine,
    createScheduledRun,
    getLocalTimeZone,
    syncScheduleAlarms,
    syncScheduleCalendarNotifications,
} from "@/modules/scheduler";

import { executeClaimedAgentRun, executeSubagentTask, type AgentRunDeps } from "./agent-run";
import { createRunUiPublisher } from "./run-ui-publisher";
import { reconcileHydratedAttachments } from "./reconcile-attachments";
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
    approvePendingToolApprovalForChat: () => void;
    pendingQuestionnaire: PendingQuestionnaire | null;
    submitPendingQuestionnaire: (
        answers: PendingQuestionnaireAnswer[],
    ) => void;
    dismissPendingQuestionnaire: () => void;
    pendingSecretRequest: PendingSecretRequest | null;
    submitPendingSecretRequest: (value: string) => void;
    dismissPendingSecretRequest: () => void;
    agentRuns: AgentRun[];
    activeProviderAccountIds: Record<string, string | null>;
    cancelRun: (input?: {
        conversationId?: string;
        runId?: string;
    }) => Promise<void>;
    clearProviderApiKey: (providerId: string) => Promise<void>;
    clearWorkspaceFiles: () => Promise<void>;
    deleteWorkspaceFile: (fileId: string) => Promise<void>;
    clearMcpServerCredentials: (serverId: string) => Promise<void>;
    connectOpenAIOAuth: (providerId?: string) => Promise<void>;
    addOpenAiOAuthAccount: (input: {
        label?: string;
        providerId: string;
    }) => Promise<void>;
    connectMcpServerOAuth: (serverId: string) => Promise<void>;
    createProviderAccount: (input: {
        apiKey?: string;
        label: string;
        providerId: string;
    }) => Promise<ProviderAccount>;
    switchProviderAccount: (input: {
        accountId: string;
        providerId: string;
    }) => Promise<void>;
    deleteProviderAccount: (input: {
        accountId: string;
        providerId: string;
    }) => Promise<void>;
    updateProviderAccountLabel: (input: {
        accountId: string;
        label: string;
    }) => Promise<void>;
    createMcpServerOAuth: (input: {
        enabled?: boolean;
        label: string;
        oauthAllowedAuthOrigin?: string | null;
        oauthAuthorizationUrl?: string | null;
        oauthClientId?: string | null;
        oauthMode?: McpServerOAuthMode;
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
        oauthMode?: McpServerOAuthMode;
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
    createConversation: (input?: { agentId?: string | null }) => Promise<void>;
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
        sourceUrl?: string | null;
        extraFiles?: string[];
        localFiles?: {
            path: string;
            content: string;
            mimeType: string | null;
            size: number | null;
        }[];
    }) => Promise<SkillConfig>;
    exportSkillMarkdown: (skillId: string) => string;
    addSkillFiles: (
        skillId: string,
        files: {
            path: string;
            content: string;
            mimeType?: string | null;
            size?: number | null;
        }[],
    ) => Promise<void>;
    agents: AgentConfig[];
    createAgent: (input: {
        description?: string | null;
        mode?: AgentConfig["mode"];
        modelModelId?: string | null;
        modelProviderId?: string | null;
        name: string;
        prompt?: string | null;
        sourceMarkdown?: string | null;
        temperature?: number | null;
        toolPermissions?: AgentConfig["toolPermissions"];
        docs?: Omit<AgentConfig["docs"][number], "createdAt" | "updatedAt" | "id">[];
    }) => Promise<AgentConfig>;
    updateAgent: (
        agentId: string,
        input: {
            description?: string | null;
            enabled?: boolean;
            hidden?: boolean;
            mode?: AgentConfig["mode"];
            modelModelId?: string | null;
            modelProviderId?: string | null;
            name?: string;
            prompt?: string | null;
            sourceMarkdown?: string | null;
            temperature?: number | null;
            toolPermissions?: AgentConfig["toolPermissions"];
            docs?: Omit<AgentConfig["docs"][number], "createdAt" | "updatedAt" | "id">[];
        },
    ) => Promise<void>;
    deleteAgent: (agentId: string) => Promise<void>;
    importAgentMarkdown: (input: {
        markdown: string;
        replaceById?: string | null;
    }) => Promise<AgentConfig>;
    exportAgentMarkdown: (agentId: string) => string;
    createSavedPrompt: (input: {
        content: string;
        title: string;
    }) => Promise<SavedPrompt>;
    createSchedule: (input: {
        autoApprove?: boolean;
        expression: string;
        externalFolderSession?: ExternalFolderSession | null;
        modelId: string;
        prompt: string;
        providerId: string;
        timezone?: string;
        title: string;
    }) => Promise<Schedule>;
    deleteSchedule: (id: string) => Promise<void>;
    refreshScheduler: () => void;
    schedules: Schedule[];
    updateSchedule: (
        id: string,
        input: Parameters<Repositories["scheduleRepository"]["update"]>[1],
    ) => Promise<void>;
    updateSchedulingEnabled: (enabled: boolean) => Promise<void>;
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
    deletePlugin: (pluginId: string) => Promise<void>;
    importPlugin: (source: string, sourceUrl?: string) => Promise<PluginConfig>;
    deleteSavedPrompt: (savedPromptId: string) => Promise<void>;
    disconnectOpenAIOAuth: (providerId?: string) => Promise<void>;
    error: string | null;
    hydrating: boolean;
    modelDiscoveryInProgress: boolean;
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
    providerAccounts: ProviderAccount[];
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
    exportConversationJson: (conversationId: string) => Promise<string>;
    importConversationJson: (json: string) => Promise<Conversation>;
    selectModel: (modelRef: ModelRef) => Promise<void>;
    sendMessage: (input: SendMessageInput) => Promise<void>;
    /** Pending (not yet delivered) mid-run prompts for all conversations. */
    pendingInputs: PendingInput[];
    cancelPendingInput: (pendingInputId: string) => Promise<void>;
    sending: boolean;
    stopSending: () => Promise<void>;
    reasoningEffort: ReasoningEffort;
    setReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
    currentSelectedAgentId: string | null;
    conversationAgentName: string;
    setConversationAgent: (
        conversationId: string,
        agentIdOrName: string | null,
    ) => Promise<void>;
    setCurrentSelectedFileIds: (selectedFileIds: string[]) => Promise<void>;
    setCurrentSelectedMcpServerIds: (
        selectedMcpServerIds: string[] | null,
    ) => Promise<void>;
    setCurrentSelectedSkillIds: (selectedSkillIds: string[]) => Promise<void>;
    setDefaultModelPreset: (modelPresetId: string) => Promise<void>;
    settings: AppSettings;
    testMcpServer: (serverId: string) => Promise<void>;
    conversations: Conversation[];
    conversationApprovalModes?: Record<string, ToolApprovalMode>;
    conversationApprovedTools?: Record<string, string[]>;
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
    setConversationApprovalMode: (
        conversationId: string,
        mode: ToolApprovalMode,
    ) => void;
    /** Remember one tool for a chat without changing its approval mode. */
    approveToolForChat: (conversationId: string, toolName: string) => void;
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
    updatePlugin: (
        pluginId: string,
        input: { enabled?: boolean; options?: Record<string, unknown> | null },
    ) => Promise<void>;
    updateSavedPrompt: (
        savedPromptId: string,
        input: {
            content?: string;
            title?: string;
        },
    ) => Promise<void>;
    skills: SkillConfig[];
    plugins: PluginConfig[];
    pluginActions: PluginActionInfo[];
    pluginTools: PluginToolInfo[];
    runPluginAction: (
        pluginId: string,
        name: string,
        args?: Record<string, unknown>,
        onProgress?: Parameters<PluginRuntimeSnapshot["runAction"]>[3],
    ) => ReturnType<PluginRuntimeSnapshot["runAction"]>;
    runPluginTool: (
        pluginId: string,
        name: string,
        args?: Record<string, unknown>,
        onProgress?: Parameters<PluginRuntimeSnapshot["runTool"]>[3],
    ) => ReturnType<PluginRuntimeSnapshot["runTool"]>;
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

const AppStateContext = createContext<AppContextValue | null>(null);

// Domain-split contexts (see provider memos below). Key lists partition
// AppStateContextValue keys; _ALL_KEYS_COVERED fails compile on drift.
// Type-registry: intentionally value-level only for Pick<> + coverage check.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHAT_KEYS = [
    "resolveNotificationApproval",
    "approvePendingToolApproval",
    "approvePendingToolApprovalForChat",
    "approveToolForChat",
    "agentRuns",
    "cancelRun",
    "clearConversationFolder",
    "createConversation",
    "importConversationJson",
    "exportConversationJson",
    "currentConversation",
    "currentExternalFolderSession",
    "currentSelectedAgentId",
    "currentSelectedFileIds",
    "currentSelectedSkillIds",
    "deleteConversation",
    "pendingToolApproval",
    "denyPendingToolApproval",
    "pendingQuestionnaire",
    "submitPendingQuestionnaire",
    "dismissPendingQuestionnaire",
    "pendingSecretRequest",
    "submitPendingSecretRequest",
    "dismissPendingSecretRequest",
    "messages",
    "editAndResendMessage",
    "pickConversationFolder",
    "renameConversation",
    "resumePendingRuns",
    "retryRun",
    "runStatusByConversation",
    "selectConversation",
    "setConversationPinned",
    "sendMessage",
    "sending",
    "stopSending",
    "pendingInputs",
    "cancelPendingInput",
    "reasoningEffort",
    "setReasoningEffort",
    "conversationAgentName",
    "setConversationAgent",
    "setCurrentSelectedFileIds",
    "setCurrentSelectedSkillIds",
    "conversations",
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CONFIG_KEYS = [
    "clearMcpServerCredentials",
    "clearProviderApiKey",
    "connectMcpServerOAuth",
    "connectOpenAIOAuth",
    "addOpenAiOAuthAccount",
    "createProviderAccount",
    "switchProviderAccount",
    "deleteProviderAccount",
    "updateProviderAccountLabel",
    "activeProviderAccountIds",
    "providerAccounts",
    "createMcpServer",
    "createMcpServerOAuth",
    "writeMemory",
    "createProvider",
    "createModelPreset",
    "createSavedPrompt",
    "createSchedule",
    "createSkill",
    "createAgent",
    "updateAgent",
    "deleteAgent",
    "importAgentMarkdown",
    "exportAgentMarkdown",
    "currentSelectedMcpServerIds",
    "agents",
    "deleteProvider",
    "deleteSchedule",
    "deleteMcpServer",
    "clearMemory",
    "deleteModelPreset",
    "deleteSavedPrompt",
    "deleteSkill",
    "deletePlugin",
    "disconnectOpenAIOAuth",
    "importSkillMarkdown",
    "importPlugin",
    "exportSkillMarkdown",
    "runPluginAction",
    "runPluginTool",
    "pluginActions",
    "pluginTools",
    "savedPrompts",
    "memory",
    "mcpServers",
    "refreshScheduler",
    "resolvedConfig",
    "saveProviderApiKey",
    "saveMcpServerHeaderValues",
    "schedules",
    "selectModel",
    "setCurrentSelectedMcpServerIds",
    "setDefaultModelPreset",
    "settings",
    "skills",
    "plugins",
    "testMcpServer",
    "conversationApprovalModes",
    "conversationApprovedTools",
    "updateMcpServer",
    "updateDatabaseSettings",
    "updateBuiltInToolSettings",
    "updateMemoryEnabled",
    "updateSavedPrompt",
    "updateSchedule",
    "updateSchedulingEnabled",
    "updateSkill",
    "updatePlugin",
    "addSkillFiles",
    "setConversationApprovalMode",
    "updateThemeMode",
    "updateProvider",
    "importFiles",
    "refreshWorkspaceFiles",
    "workspaceFiles",
    "clearWorkspaceFiles",
    "deleteWorkspaceFile",
    "createWorkspaceFile",
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const APP_KEYS = [
    "updateNotificationSettings",
    "dismissInAppNotification",
    "error",
    "hydrating",
    "inAppNotification",
    "modelDiscoveryInProgress",
    "ready",
    "refresh",
] as const;
type ChatContextValue = Pick<AppStateContextValue, (typeof CHAT_KEYS)[number]>;
type ConfigContextValue = Pick<AppStateContextValue, (typeof CONFIG_KEYS)[number]>;
type AppContextValue = Pick<AppStateContextValue, (typeof APP_KEYS)[number]>;
type _AllKeysCovered = Exclude<keyof AppStateContextValue, (typeof CHAT_KEYS)[number] | (typeof CONFIG_KEYS)[number] | (typeof APP_KEYS)[number]> extends never ? true : never;
const _allKeysCovered: _AllKeysCovered = true;
void _allKeysCovered;

const ChatStateContext = createContext<ChatContextValue | null>(null);
const ConfigStateContext = createContext<ConfigContextValue | null>(null);

function useChatStateContext() {
    const context = useContext(ChatStateContext);

    if (!context) {
        throw new Error("App state hooks must be used within AppStateProvider.");
    }

    return context;
}

function useConfigStateContext() {
    const context = useContext(ConfigStateContext);

    if (!context) {
        throw new Error("App state hooks must be used within AppStateProvider.");
    }

    return context;
}

function getHeaderNames(headers?: Record<string, string>) {
    return Object.entries(headers ?? {})
        .filter(([name, value]) => name.trim() && value.trim())
        .map(([name]) => name.trim());
}

function mimeToExtension(mime: string) {
    switch (mime.split(";")[0].trim().toLowerCase()) {
        case "text/html":
            return ".html";
        case "text/markdown":
        case "text/x-markdown":
            return ".md";
        case "text/plain":
            return ".txt";
        case "text/csv":
            return ".csv";
        case "application/json":
            return ".json";
        case "image/png":
            return ".png";
        case "image/jpeg":
            return ".jpg";
        case "image/svg+xml":
            return ".svg";
        case "application/pdf":
            return ".pdf";
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return ".docx";
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return ".xlsx";
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return ".pptx";
        default:
            return ".txt";
    }
}

export function AppStateProvider({ children }: AppStateProviderProps) {
    const db = useSQLiteContext();
    const repositoriesRef = useRef(createRepositories(db));
    const snapshotRef = useRef<AppStateSnapshot>(EMPTY_SNAPSHOT);
    const fileSelectionRevisionRef = useRef(0);
    const workspaceServiceRef = useRef(
        createWorkspaceFileService(repositoriesRef.current.workspaceRepository),
    );
    const pluginRuntimeRef = useRef(
        createPluginRuntime(
            repositoriesRef.current.pluginRepository.storage,
            () => {
                const model = snapshotRef.current.resolvedConfig.currentModel;
                if (!model) return null;
                const provider =
                    snapshotRef.current.resolvedConfig.providers.find(
                        (item) => item.id === model.providerId,
                    ) ?? null;
                return provider ? { model, provider } : null;
            },
            {
                materializeAttachment: async (attachment, signal) => {
                    if (attachment.uri.startsWith("workspace://")) return attachment;
                    const service = workspaceServiceRef.current;
                    const name = attachment.filename ?? `plugin-file${mimeToExtension(attachment.mime)}`;
                    let bytes: Uint8Array;
                    if (/^https?:\/\//i.test(attachment.uri)) {
                        const response = await fetch(attachment.uri, { signal });
                        if (!response.ok) throw new Error(`Plugin file download failed: HTTP ${response.status}`);
                        bytes = new Uint8Array(await response.arrayBuffer());
                    } else if (attachment.uri.startsWith("data:")) {
                        const match = /^data:([^,]*),(.*)$/s.exec(attachment.uri);
                        if (!match) throw new Error("Invalid plugin data attachment.");
                        if (match[1].endsWith(";base64")) {
                            const decoded = atob(match[2]);
                            bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
                        } else {
                            bytes = new TextEncoder().encode(decodeURIComponent(match[2]));
                        }
                    } else if (/^(file|content):\/\//i.test(attachment.uri)) {
                        bytes = await new File(attachment.uri).bytes();
                    } else {
                        throw new Error("Unsupported plugin attachment URI. Use a workspace, HTTP(S), data, or local file URI.");
                    }
                    signal.throwIfAborted();
                    const file = await service.importBytesFile({ bytes, name, mimeType: attachment.mime });
                    setSnapshot((current) => ({
                        ...current,
                        workspaceFiles: upsertWorkspaceFiles(current.workspaceFiles, [file]),
                    }));
                    return { filename: file.displayName, mime: attachment.mime, uri: `workspace://${file.id}` };
                },
                materializeResultFile: async ({ content, mime, title }) => {
                    const mediaType = mime.split(";")[0].trim().toLowerCase();
                    if (!(mediaType.startsWith("text/") || [
                        "application/json", "application/xml", "application/javascript", "image/svg+xml",
                    ].includes(mediaType))) {
                        throw new Error("Binary plugin results must use attachments with a URI, not a text output field.");
                    }
                    const extension = mimeToExtension(mime);
                    const base =
                        (title ?? "plugin-result")
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-+|-+$/g, "") || "plugin-result";
                    const service = workspaceServiceRef.current;
                    await service.ensureWorkspaceDirectory();
                    const file = await service.createTextFile({
                        content,
                        mimeType: mime,
                        name: `${base}${extension}`,
                    });
                    setSnapshot((current) => ({
                        ...current,
                        workspaceFiles: upsertWorkspaceFiles(current.workspaceFiles, [file]),
                    }));

                    return { id: file.id, displayName: file.displayName };
                },
            },
        ),
    );
    const externalFolderServiceRef = useRef(createExternalFolderService());
    const runRegistryRef = useRef(createRunControllerRegistry());
    if (runRegistryRef.current.version !== 4 || runRegistryRef.current.isDisposed()) {
        runRegistryRef.current.dispose?.();
        runRegistryRef.current = createRunControllerRegistry();
    }
    useEffect(() => {
        // Fast Refresh/error-boundary teardown can close SQLite while the
        // model stream is still running. Its old runs must not persist later.
        if (runRegistryRef.current.isDisposed()) {
            runRegistryRef.current = createRunControllerRegistry();
        }
        const registry = runRegistryRef.current;
        return () => registry.dispose();
    }, [db]);
    const [snapshot, setSnapshot] = useState<AppStateSnapshot>(EMPTY_SNAPSHOT);
    const [pluginActions, setPluginActions] = useState<PluginActionInfo[]>([]);
    const [pluginTools, setPluginTools] = useState<PluginToolInfo[]>([]);
    const [ready, setReady] = useState(false);
    const [hydrating, setHydrating] = useState(true);
    const [modelDiscoveryInProgress, setModelDiscoveryInProgress] =
        useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingToolApprovals, setPendingToolApprovals] = useState<
        PendingToolApproval[]
    >([]);
    const [pendingQuestionnaires, setPendingQuestionnaires] = useState<
        PendingQuestionnaire[]
    >([]);
    const [pendingSecretRequests, setPendingSecretRequests] = useState<
        PendingSecretRequest[]
    >([]);

    useEffect(() => {
        const runtime = pluginRuntimeRef.current;
        return () => {
            void runtime.dispose();
        };
    }, []);
    const [inAppNotification, setInAppNotification] = useState<{
        body: string;
        conversationId: string;
        id: string;
        title: string;
    } | null>(null);
    const pendingToolApprovalsRef = useRef<PendingToolApproval[]>(
        pendingToolApprovals,
    );
    const pendingQuestionnairesRef = useRef<PendingQuestionnaire[]>(
        pendingQuestionnaires,
    );
    const pendingSecretRequestsRef = useRef<PendingSecretRequest[]>(
        pendingSecretRequests,
    );
    const appStateRef = useRef(AppState.currentState);
    const legacyProviderSecretCleanedRef = useRef(false);
    const hydrationGenerationRef = useRef(0);
    const coldStartRef = useRef(true);
    const pendingAgentRunIdsRef = useRef<string[]>([]);
    const executeAgentRunRef = useRef<(runId: string) => Promise<void>>(
        async (runId) => {
            pendingAgentRunIdsRef.current.push(runId);
        },
    );
    // Set alongside sendMessage below; lets executeAgentRun (declared
    // earlier) promote stranded/queued inputs when a run settles.
    const promoteAfterRunRef = useRef<(runId: string) => void>(() => {});
    // Boot sweep hook, assigned with the other inbox callbacks below.
    const promoteBootPendingInputsRef = useRef<() => Promise<void>>(
        async () => {},
    );
    const schedulerEngineRef = useRef<ReturnType<typeof createSchedulerEngine> | null>(
        null,
    );

    snapshotRef.current = snapshot;
    pendingToolApprovalsRef.current = pendingToolApprovals;
    pendingQuestionnairesRef.current = pendingQuestionnaires;
    pendingSecretRequestsRef.current = pendingSecretRequests;

    useEffect(() => {
        logMessageDebug("snapshot-updated", {
            currentConversationId: snapshot.currentConversation?.id ?? null,
            messages: buildMessageDebugSummary(snapshot.messages),
        });
    }, [snapshot.currentConversation?.id, snapshot.messages]);

    const resolvePendingToolApproval = useCallback(
        (
        
        approval: PendingToolApproval,
        decision: import("@/modules/runtime/run-manager").ToolApprovalDecision,
        ) => {
        runRegistryRef.current.resolvePendingApproval(
            approval.runId,
            approval.id,
            decision,
        );
        setPendingToolApprovals((current) =>
            current.filter((item) => item.id !== approval.id),
        );
        dismissApprovalNotification(approval.runId).catch(() => { });

        setBackgroundAgentNotificationState("running").catch(() => { });
    },
        [],
    );

    const resolvePendingQuestionnaire = useCallback(
        (
        
        questionnaire: PendingQuestionnaire,
        answers: PendingQuestionnaireAnswer[] | null,
        ) => {
        runRegistryRef.current.resolvePendingQuestionnaire(
            questionnaire.runId,
            questionnaire.id,
            answers,
        );
        setPendingQuestionnaires((current) =>
            current.filter((item) => item.id !== questionnaire.id),
        );

        dismissQuestionNotification(questionnaire.runId).catch(() => { });

        setBackgroundAgentNotificationState("running").catch(() => { });
    },
        [],
    );

    const requestRunQuestionnaire = useCallback(
        async (
        
        run: AgentRun,
        request: import("@/core/types/app-state").PendingQuestionnaireRequest,
        ): Promise<PendingQuestionnaireAnswer[] | null> => {
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

        const notificationSettings =
            snapshotRef.current.settings.notificationSettings;
        const currentConversationId =
            snapshotRef.current.currentConversation?.id ?? null;
        const questionCount = questionnaire.items.length;

        if (appStateRef.current === "active") {
            if (currentConversationId !== questionnaire.conversationId) {
                setInAppNotification({
                    body:
                        questionCount === 1
                            ? "The agent is waiting for your answer."
                            : `The agent is waiting for answers to ${questionCount} questions.`,
                    conversationId: questionnaire.conversationId,
                    id: `${questionnaire.conversationId}:question:${questionnaire.id}`,
                    title: `${questionnaire.chatTitle} has a question`,
                });
            }
        } else if (notificationSettings.questionRequests) {
            notifyQuestionRequestedAsync({
                chatTitle: questionnaire.chatTitle,
                conversationId: questionnaire.conversationId,
                questionCount,
                questionnaireId: questionnaire.id,
                runId: questionnaire.runId,
            }).catch(() => { });
        }

        announceAsync({
            appState: appStateRef.current,
            conversationId: questionnaire.conversationId,
            kind: "questions",
            settings: notificationSettings,
            text:
                questionCount === 1
                    ? `The agent has a question in ${questionnaire.chatTitle}.`
                    : `The agent has questions in ${questionnaire.chatTitle}.`,
        }).catch(() => { });

        setBackgroundAgentNotificationState("waiting_approval").catch(() => { });

        return await new Promise<PendingQuestionnaireAnswer[] | null>((resolve) => {
            runRegistryRef.current.registerPendingQuestionnaire(
                run.id,
                questionnaire.id,
                resolve,
            );
        });
    },
        [],
    );

    const resolvePendingSecretRequest = useCallback(
        (
        
        secretRequest: PendingSecretRequest,
        answer: PendingSecretRequestAnswer,
        ) => {
        runRegistryRef.current.resolvePendingSecretRequest(
            secretRequest.runId,
            secretRequest.id,
            answer,
        );
        setPendingSecretRequests((current) =>
            current.filter((item) => item.id !== secretRequest.id),
        );

        dismissSecretNotification(secretRequest.runId).catch(() => { });

        setBackgroundAgentNotificationState("running").catch(() => { });
    },
        [],
    );

    const submitPendingSecretRequest = useCallback(
        async (value: string) => {
        const secretRequest = pendingSecretRequestsRef.current.find(
            (item) =>
                item.conversationId === snapshotRef.current.currentConversation?.id,
        );

        if (!secretRequest) {
            return;
        }

        const normalized = value.trim();
        if (normalized) {
            await secureSecretStore.setPluginSecret(
                secretRequest.pluginId,
                secretRequest.key,
                normalized,
            );
        }
        resolvePendingSecretRequest(secretRequest, { status: "stored" });
    },
        [resolvePendingSecretRequest],
    );

    const dismissPendingSecretRequest = useCallback(
        () => {
        const secretRequest = pendingSecretRequestsRef.current.find(
            (item) =>
                item.conversationId === snapshotRef.current.currentConversation?.id,
        );

        if (!secretRequest) {
            return;
        }

        resolvePendingSecretRequest(secretRequest, { status: "deferred" });
    },
        [resolvePendingSecretRequest],
    );

    const requestRunSecret = useCallback(
        async (
        
        run: AgentRun,
        request: PendingSecretRequestRequest,
        ): Promise<PendingSecretRequestAnswer> => {
        const conversation =
            snapshotRef.current.conversations.find(
                (item) => item.id === run.conversationId,
            ) ?? snapshotRef.current.currentConversation;
        const plugin = snapshotRef.current.plugins.find(
            (item) => item.id === request.pluginId,
        );
        const configuredKeys =
            request.scope === "plugin"
                ? await secureSecretStore.listPluginSecretKeys(request.pluginId)
                : [];
        const secretRequest = createPendingSecretRequest(
            run,
            conversation?.title ?? "Chat",
            request,
            plugin?.name ?? request.pluginId,
            configuredKeys.includes(request.key),
        );

        setPendingSecretRequests((current) => [...current, secretRequest]);

        const notificationSettings =
            snapshotRef.current.settings.notificationSettings;
        const currentConversationId =
            snapshotRef.current.currentConversation?.id ?? null;

        if (appStateRef.current === "active") {
            if (currentConversationId !== secretRequest.conversationId) {
                setInAppNotification({
                    body: `${secretRequest.pluginName} needs ${secretRequest.key}.`,
                    conversationId: secretRequest.conversationId,
                    id: `${secretRequest.conversationId}:secret:${secretRequest.id}`,
                    title: `${secretRequest.chatTitle} needs a secret`,
                });
            }
        } else if (notificationSettings.questionRequests) {
            notifySecretRequestedAsync({
                chatTitle: secretRequest.chatTitle,
                conversationId: secretRequest.conversationId,
                key: secretRequest.key,
                pluginName: secretRequest.pluginName,
                runId: secretRequest.runId,
                secretRequestId: secretRequest.id,
            }).catch(() => { });
        }

        announceAsync({
            appState: appStateRef.current,
            conversationId: secretRequest.conversationId,
            kind: "permissions",
            settings: notificationSettings,
            text: `${secretRequest.pluginName} needs a secret in ${secretRequest.chatTitle}.`,
        }).catch(() => { });

        setBackgroundAgentNotificationState("waiting_approval").catch(() => { });

        return await new Promise<PendingSecretRequestAnswer>((resolve) => {
            runRegistryRef.current.registerPendingSecretRequest(
                run.id,
                secretRequest.id,
                resolve,
            );
        });
    },
        [],
    );


    const requestToolApproval = useCallback(
        async (
        
        run: AgentRun,
        request: PendingToolApprovalRequest,
        ) => {
        if (
            (snapshotRef.current.conversationApprovalModes?.[run.conversationId] ??
                "ask") !== "ask"
        ) {
            return "approve" satisfies import("@/modules/runtime/run-manager").ToolApprovalDecision;
        }

        if (
            snapshotRef.current.conversationApprovedTools?.[
                run.conversationId
            ]?.includes(request.toolName)
        ) {
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

        announceAsync({
            appState: appStateRef.current,
            conversationId: approval.conversationId,
            kind: "permissions",
            settings: snapshotRef.current.settings.notificationSettings,
            text: `The agent needs permission in ${approval.chatTitle}.`,
        }).catch(() => { });

        setBackgroundAgentNotificationState("waiting_approval").catch(() => { });

        return await new Promise<
            import("@/modules/runtime/run-manager").ToolApprovalDecision
        >((resolve) => {
            runRegistryRef.current.registerPendingApproval(
                run.id,
                approval.id,
                resolve,
            );
        });
    },
        [],
    );

    const dismissInAppNotification = useCallback(
        () => {
        setInAppNotification(null);
    },
        [],
    );

    const notifyRunStateChange = useCallback(
        async (
        input: {
        announcement?: { message: string | null } | null;
        body: string;
        conversationId: string;
        status: "success" | "failed";
        title: string;
        }) => {
        const notificationSettings =
            snapshotRef.current.settings.notificationSettings;
        const currentConversationId =
            snapshotRef.current.currentConversation?.id ?? null;
        const forced = Boolean(input.announcement);
        const active = appStateRef.current === "active";
        const alertBody =
            input.status === "success" && input.announcement?.message
                ? input.announcement.message
                : input.body;

        if (active) {
            if (currentConversationId !== input.conversationId) {
                setInAppNotification({
                    body: alertBody,
                    conversationId: input.conversationId,
                    id: `${input.conversationId}:${Date.now()}`,
                    title: input.title,
                });
            }
        } else if (forced || notificationSettings.runFinished) {
            await notifyRunFinishedAsync({
                body: alertBody,
                conversationId: input.conversationId,
                status: input.status,
                title: input.title,
            }).catch(() => { });
        }

        const fallback =
            input.status === "success"
                ? `Agent finished in ${input.title}.`
                : `Agent failed in ${input.title}.`;

        await announceAsync({
            appState: appStateRef.current,
            conversationId: input.conversationId,
            force: forced,
            kind: "finished",
            settings: notificationSettings,
            text: input.announcement?.message?.trim() || fallback,
        }).catch(() => { });
    },
        [],
    );

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


    const hydrate = useCallback(async () => {
        const fileSelectionRevision = fileSelectionRevisionRef.current;
        const hydrationGeneration = ++hydrationGenerationRef.current;
        setHydrating(true);
        setError(null);

        try {
            const repositories = repositoriesRef.current;

            await repositories.configRepository.ensureDefaultProviders();
            if (!legacyProviderSecretCleanedRef.current) {
                try {
                    await secureSecretStore.deleteLegacyProviderApiKey("openai-compatible");
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

            // Ensure provider accounts exist and migrate legacy credentials
            if (repositories.providerAccountRepository) {
                const existingAccounts =
                    await repositories.providerAccountRepository.listAll();
                const accountsByProvider = new Map<string, typeof existingAccounts>();
                for (const acct of existingAccounts) {
                    const list = accountsByProvider.get(acct.providerId) ?? [];
                    list.push(acct);
                    accountsByProvider.set(acct.providerId, list);
                }

                for (const provider of providers) {
                    const accounts = accountsByProvider.get(provider.id) ?? [];
                    if (accounts.length === 0) {
                        // Create a default account for this provider
                        const defaultLabel =
                            provider.label || provider.id.replace(/-/g, " ");
                        const newAccount =
                            await repositories.providerAccountRepository.create({
                                credentialKind:
                                    provider.authType === "oauth"
                                        ? "oauth"
                                        : "apiKey",
                                providerId: provider.id,
                                label: defaultLabel,
                            });
                        accounts.push(newAccount);
                    }

                    // Migrate legacy credential into the first account
                    if (provider.authType === "apiKey" && accounts.length > 0) {
                        const legacyKey =
                            await secureSecretStore.getLegacyProviderApiKey(provider.id);
                        if (legacyKey) {
                            await secureSecretStore.setProviderAccountApiKey(
                                accounts[0].id,
                                legacyKey,
                            );
                            await secureSecretStore.setActiveProviderAccount(
                                provider.id,
                                accounts[0].id,
                            );
                            await secureSecretStore
                                .deleteLegacyProviderApiKey(provider.id)
                                .catch(() => {});
                        }
                    }

                    // Ensure active account is set for the provider
                    const activeAccountId =
                        await secureSecretStore.getActiveProviderAccountId(provider.id);
                    if (!activeAccountId && accounts.length > 0) {
                        await secureSecretStore.setActiveProviderAccount(
                            provider.id,
                            accounts[0].id,
                        );
                    }
                }

                // Migrate legacy OpenAI OAuth tokens into an account
                if (accountsByProvider.has("openai")) {
                    const openaiAccounts = accountsByProvider.get("openai") ?? [];
                    const targetAccountId = openaiAccounts[0]?.id;
                    if (targetAccountId) {
                        const existingAccountInfo =
                            await getOpenAiTokenInfoForAccount(targetAccountId);
                        const legacyInfo = await getOpenAiTokenInfo();
                        if (
                            (legacyInfo.accessToken || legacyInfo.refreshToken) &&
                            !existingAccountInfo.accessToken &&
                            !existingAccountInfo.refreshToken
                        ) {
                            const { migrateLegacyOpenAiTokensToAccount } = await import(
                                "@/modules/providers/openai-oauth"
                            );
                            await migrateLegacyOpenAiTokensToAccount(targetAccountId);
                            await secureSecretStore.setActiveProviderAccount(
                                "openai",
                                targetAccountId,
                            );
                        }

                        // Accounts are labelled with the signed-in email.
                        const email =
                            existingAccountInfo.email ?? legacyInfo.email;
                        const targetAccount = openaiAccounts[0];
                        if (email && targetAccount.label !== email) {
                            await repositories.providerAccountRepository?.updateLabel(
                                targetAccountId,
                                email,
                            );
                        }
                    }
                }

                // Migrate legacy ChatGPT-plan OAuth tokens into an account
                if (accountsByProvider.has("openai-chatgpt")) {
                    const chatGptAccounts =
                        accountsByProvider.get("openai-chatgpt") ?? [];
                    const targetAccountId = chatGptAccounts[0]?.id;
                    if (targetAccountId) {
                        const existingAccountInfo =
                            await getOpenAiChatGptTokenInfoForAccount(
                                targetAccountId,
                            );
                        const legacyInfo = await getOpenAiChatGptTokenInfo();
                        if (
                            (legacyInfo.accessToken || legacyInfo.refreshToken) &&
                            !existingAccountInfo.accessToken &&
                            !existingAccountInfo.refreshToken
                        ) {
                            const { migrateLegacyOpenAiChatGptTokensToAccount } =
                                await import(
                                    "@/modules/providers/openai-chatgpt-oauth"
                                );
                            await migrateLegacyOpenAiChatGptTokensToAccount(
                                targetAccountId,
                            );
                            await secureSecretStore.setActiveProviderAccount(
                                "openai-chatgpt",
                                targetAccountId,
                            );
                        }

                        // Accounts are labelled with the signed-in email.
                        const email =
                            existingAccountInfo.email ?? legacyInfo.email;
                        const targetAccount = chatGptAccounts[0];
                        if (email && targetAccount.label !== email) {
                            await repositories.providerAccountRepository?.updateLabel(
                                targetAccountId,
                                email,
                            );
                        }
                    }
                }
            }

            const providerAccounts = repositories.providerAccountRepository
                ? await repositories.providerAccountRepository.listAll()
                : [];
            const activeProviderAccountIds: Record<string, string | null> = {};
            for (const provider of providers) {
                activeProviderAccountIds[provider.id] =
                    await secureSecretStore.getActiveProviderAccountId(provider.id);
            }

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
            const pendingInputs =
                await repositories.pendingInputRepository.listAll();
            const savedPrompts = await repositories.savedPromptRepository.list();
            const schedules = await repositories.scheduleRepository.list();
            const skills = await repositories.skillRepository.list();
            const plugins = await repositories.pluginRepository.list();
            const pluginErrors = await pluginRuntimeRef.current.load(plugins);
            setPluginActions(pluginRuntimeRef.current.snapshot("app").actions);
            setPluginTools(pluginRuntimeRef.current.snapshot("app").toolInfos);
            const pluginErrorById = new Map(
                pluginErrors.map((item) => [item.id, item.error]),
            );
            await Promise.all(
                plugins.map((plugin) => {
                    const lastError = pluginErrorById.get(plugin.id) ?? null;
                    if (lastError === plugin.lastError) return Promise.resolve();
                    return repositories.pluginRepository.update(plugin.id, { lastError });
                }),
            );
            const hydratedPlugins = plugins.map((plugin) => ({
                ...plugin,
                lastError: pluginErrorById.get(plugin.id) ?? null,
            }));
            const workspaceFiles = await repositories.workspaceRepository.list();
            const agents = await repositories.agentRepository.list();
            const conversationApprovalModes =
                await repositories.configRepository.getConversationApprovalModes();
            const conversationApprovedTools =
                await repositories.configRepository.getApprovedToolsByConversation();
            const nextSnapshot = {
                activeProviderAccountIds,
                agentRuns: normalizedAgentRuns,
                agents,
                conversations,
                conversationApprovalModes,
                conversationApprovedTools,
                currentConversation,
                currentSelectedAgentId: currentConversation?.agentId ?? null,
                currentSelectedFileIds: currentConversation?.selectedFileIds ?? [],
                currentSelectedMcpServerIds:
                    currentConversation?.selectedMcpServerIds ?? null,
                currentSelectedSkillIds: currentConversation?.selectedSkillIds ?? [],
                memory,
                mcpServers,
                messages,
                pendingInputs,
                plugins: hydratedPlugins,
                providerAccounts,
                savedPrompts,
                schedules,
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
                        // Keep inbox rows admitted after this hydration's DB
                        // read (steers land while runs — and hydrates — run).
                        pendingInputs: (() => {
                            const seen = new Set(
                                nextSnapshot.pendingInputs.map((item) => item.id),
                            );
                            return [
                                ...nextSnapshot.pendingInputs,
                                ...current.pendingInputs.filter(
                                    (item) => !seen.has(item.id),
                                ),
                            ];
                        })(),
                    }
                    : nextSnapshot;
                const attachmentSafeSnapshot = reconcileHydratedAttachments(
                    reconciledSnapshot,
                    current,
                    fileSelectionRevision !== fileSelectionRevisionRef.current,
                );
                snapshotRef.current = attachmentSafeSnapshot;
                return attachmentSafeSnapshot;
            });
            setReady(true);

            setModelDiscoveryInProgress(true);
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
                })
                .finally(() => {
                    setModelDiscoveryInProgress(false);
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
            snapshotRef.current.settings.notificationSettings.runFinished ||
            snapshotRef.current.settings.notificationSettings.questionRequests;

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

        if (!runRegistryRef.current.hasActiveRuns()) {
            stopBackgroundAgent();
        }

        resumePendingRuns().catch(() => { });
        // Promote inbox rows whose conversation has no run to resume
        // (app killed after the run finished). Skipped automatically for
        // conversations with active/resumable runs.
        promoteBootPendingInputsRef.current().catch(() => { });
    }, [hydrating, ready, resumePendingRuns]);

    useEffect(() => {
        if (!ready || hydrating) return;
        checkPluginUpdates(repositoriesRef.current).catch(() => { });
    }, [hydrating, ready]);

    const defaultCatalogSeedStartedRef = useRef(false);

    useEffect(() => {
        if (!ready || hydrating) return;
        // Seed at most once per app launch; the effect re-runs whenever
        // `hydrate` changes identity after a re-hydration.
        if (defaultCatalogSeedStartedRef.current) return;
        defaultCatalogSeedStartedRef.current = true;

        let cancelled = false;

        const seed = async () => {
            const storedVersion = await repositoriesRef.current.configRepository.getSetting(
                DEFAULT_CATALOG_SEED_VERSION_KEY,
            );

            if (storedVersion === String(DEFAULT_CATALOG_SEED_VERSION)) return;

            const result = await seedDefaultEntries(repositoriesRef.current);

            if (result.errors.length > 0) {
                // Leave the version unset so the next launch retries the
                // entries that failed (seeding is idempotent), but log for
                // diagnostics.
                console.warn(
                    "Seeded default catalog entries with errors.",
                    result.errors,
                );
            } else {
                await repositoriesRef.current.configRepository.setSetting(
                    DEFAULT_CATALOG_SEED_VERSION_KEY,
                    String(DEFAULT_CATALOG_SEED_VERSION),
                );
            }

            if (
                !cancelled &&
                (result.installedSkillIds.length > 0 ||
                    result.installedMcpServerIds.length > 0)
            ) {
                await hydrate();
            }
        };

        seed().catch((error) => {
            // Never let seeding break startup; it will retry next launch.
            console.warn("Could not seed default catalog entries.", error);
        });

        return () => {
            cancelled = true;
        };
    }, [hydrate, hydrating, ready]);

    const dispatchScheduledRun = useCallback(async (schedule: Schedule) => {
        const { agentRun, assistantMessage, conversation, userMessage } =
            await createScheduledRun(repositoriesRef.current, schedule);

        setSnapshot((current) => {
            const isActiveConversation =
                current.currentConversation?.id === conversation.id;

            return {
                ...current,
                agentRuns: upsertAgentRun(current.agentRuns, agentRun),
                conversations: upsertConversation(
                    current.conversations,
                    conversation,
                ),
                messages: isActiveConversation
                    ? upsertMessages(current.messages, [
                        userMessage,
                        assistantMessage,
                    ])
                    : current.messages,
                schedules: current.schedules.map((item) =>
                    item.id === schedule.id && !item.conversationId
                        ? { ...item, conversationId: conversation.id }
                        : item,
                ),
            };
        });

        void executeAgentRunRef.current(agentRun.id).catch((runError) => {
            setError(
                runError instanceof Error
                    ? runError.message
                    : "Failed to start scheduled run.",
            );
        });
    }, []);

    const refreshScheduler = useCallback(() => {
        schedulerEngineRef.current?.refresh();
    }, []);

    useEffect(() => {
        if (!ready) {
            return;
        }

        schedulerEngineRef.current ??= createSchedulerEngine(
            repositoriesRef.current,
            {
                dispatchRun: (schedule) => dispatchScheduledRun(schedule),
                onError: (error) => {
                    console.warn(
                        "[scheduler]",
                        error instanceof Error ? error.message : error,
                    );
                },
                onSchedulesChanged: () => {
                    void syncScheduleAlarms(repositoriesRef.current).catch(
                        () => {},
                    );
                    void syncScheduleCalendarNotifications(
                        repositoriesRef.current,
                    ).catch(() => {});
                },
            },
        );

        schedulerEngineRef.current.start();

        return () => {
            schedulerEngineRef.current?.stop();
        };
    }, [dispatchScheduledRun, ready]);

    useEffect(() => {
        if (!ready) {
            return;
        }

        const responseSubscription =
            Notifications.addNotificationResponseReceivedListener(
                (response) => {
                    const data = response.notification.request.content
                        .data as { type?: string } | null;

                    if (data?.type === "schedule-due") {
                        refreshScheduler();
                    }
                },
            );

        return () => {
            responseSubscription.remove();
        };
    }, [ready, refreshScheduler]);

    const createSchedule = useCallback(
        async (input: {
            agentId?: string | null;
            autoApprove?: boolean;
            expression: string;
            externalFolderSession?: ExternalFolderSession | null;
            modelId: string;
            prompt: string;
            providerId: string;
            timezone?: string;
            title: string;
        }) => {
            const timezone = input.timezone ?? getLocalTimeZone();
            const nextRunAt = computeNextRun(input.expression, timezone)?.toISOString() ?? null;
            const schedule = await repositoriesRef.current.scheduleRepository.create({
                agentId: input.agentId ?? null,
                autoApprove: input.autoApprove ?? true,
                expression: input.expression,
                externalFolderSession: input.externalFolderSession ?? null,
                modelId: input.modelId,
                nextRunAt,
                prompt: input.prompt,
                providerId: input.providerId,
                timezone,
                title: input.title,
            });

            setSnapshot((current) => ({
                ...current,
                schedules: [schedule, ...current.schedules],
            }));
            refreshScheduler();
            return schedule;
        },
        [refreshScheduler],
    );

    const updateSchedule = useCallback(
        async (id: string, input: Parameters<Repositories["scheduleRepository"]["update"]>[1]) => {
            const current = await repositoriesRef.current.scheduleRepository.getById(id);

            if (!current) {
                return;
            }

            const expressionChanged =
                input.expression !== undefined &&
                input.expression !== current.expression;
            const timezoneChanged =
                input.timezone !== undefined && input.timezone !== current.timezone;
            const nextRunAt =
                input.nextRunAt !== undefined
                    ? input.nextRunAt
                    : expressionChanged || timezoneChanged
                        ? (computeNextRun(
                              input.expression ?? current.expression,
                              input.timezone ?? current.timezone,
                          )?.toISOString() ?? null)
                        : undefined;

            await repositoriesRef.current.scheduleRepository.update(id, {
                ...input,
                ...(nextRunAt !== undefined ? { nextRunAt } : {}),
            });

            const next = await repositoriesRef.current.scheduleRepository.getById(id);

            if (next) {
                setSnapshot((state) => ({
                    ...state,
                    schedules: state.schedules.map((schedule) =>
                        schedule.id === id ? next : schedule,
                    ),
                }));
            }
            refreshScheduler();
        },
        [refreshScheduler],
    );

    const deleteSchedule = useCallback(
        async (id: string) => {
            await repositoriesRef.current.scheduleRepository.delete(id);

            setSnapshot((current) => ({
                ...current,
                schedules: current.schedules.filter((schedule) => schedule.id !== id),
            }));
            refreshScheduler();
        },
        [refreshScheduler],
    );

    const updateSchedulingEnabled = useCallback(
        async (enabled: boolean) => {
            await repositoriesRef.current.configRepository.setSchedulingEnabled(enabled);

            setSnapshot((current) => ({
                ...current,
                settings: { ...current.settings, schedulingEnabled: enabled },
            }));

            if (enabled) {
                refreshScheduler();
            } else {
                if (!runRegistryRef.current.hasActiveRuns()) {
                    stopBackgroundAgent();
                }
            }

            void syncScheduleAlarms(repositoriesRef.current).catch(() => { });
        },
        [refreshScheduler],
    );

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

    const generateAndApplyConversationTitle = useCallback(
        async (
        input: {
        conversation: Conversation;
        firstUserMessage: string;
        model: ResolvedModel;
        provider: ProviderConfig;
        runId: string;
        }) => {
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
    },
        [],
    );

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

    const updateProvider = useCallback(
        async (
        
        providerId: string,
        input: {
        baseUrl?: string | null;
        enabled?: boolean;
        label?: string;
        oauthAccountEmail?: string | null;
        },
        ) => {
        await repositoriesRef.current.configRepository.updateProvider(
            providerId,
            input,
        );
        await hydrate();
    },
        [hydrate],
    );

    const deleteProvider = useCallback(
        async (providerId: string) => {
        if (getSupportedProviderDefinition(providerId)) {
            throw new Error("Built-in providers cannot be deleted.");
        }

        await repositoriesRef.current.configRepository.deleteProvider(providerId);
        try {
            if (repositoriesRef.current.providerAccountRepository) {
                const accounts =
                    await repositoriesRef.current.providerAccountRepository.listByProvider(
                        providerId,
                    );
                for (const account of accounts) {
                    await secureSecretStore.deleteProviderAccountApiKey(account.id);
                }
                await repositoriesRef.current.providerAccountRepository.deleteByProvider(
                    providerId,
                );
                await secureSecretStore.setActiveProviderAccount(providerId, null);
            } else {
                await secureSecretStore.deleteLegacyProviderApiKey(providerId);
            }
        } catch (cleanupError) {
            console.warn("Failed to delete the provider credential.", cleanupError);
        } finally {
            await hydrate();
        }
    },
        [hydrate],
    );

    const createProvider = useCallback(
        async (
        input: {
        apiKey?: string;
        authType: ProviderConfig["authType"];
        baseUrl?: string | null;
        enabled?: boolean;
        family: ProviderConfig["family"];
        id: string;
        label: string;
        oauthAccountEmail?: string | null;
        }) => {
        const provider =
            await repositoriesRef.current.configRepository.createProvider(input);

        try {
            if (repositoriesRef.current.providerAccountRepository) {
                const defaultLabel =
                    input.label || input.id.replace(/-/g, " ");
                const account =
                    await repositoriesRef.current.providerAccountRepository.create({
                        credentialKind:
                            input.authType === "oauth" ? "oauth" : "apiKey",
                        providerId: provider.id,
                        label: defaultLabel,
                    });
                if (input.apiKey) {
                    await secureSecretStore.setProviderAccountApiKey(
                        account.id,
                        input.apiKey.trim(),
                    );
                }
                await secureSecretStore.setActiveProviderAccount(
                    provider.id,
                    account.id,
                );
            } else if (input.apiKey) {
                await secureSecretStore.setLegacyProviderApiKey(
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
    },
        [hydrate],
    );


    const saveProviderApiKey = useCallback(
        async (providerId: string, apiKey: string) => {
        if (repositoriesRef.current.providerAccountRepository) {
            const activeAccountId =
                await secureSecretStore.getActiveProviderAccountId(providerId);
            let accountId = activeAccountId;

            if (!accountId) {
                // Create a default account if none exists
                const newAccount =
                    await repositoriesRef.current.providerAccountRepository.create({
                        credentialKind: "apiKey",
                        providerId,
                        label: providerId.replace(/-/g, " "),
                    });
                accountId = newAccount.id;
                await secureSecretStore.setActiveProviderAccount(
                    providerId,
                    accountId,
                );
            }

            await secureSecretStore.setProviderAccountApiKey(
                accountId,
                apiKey.trim(),
            );
        } else {
            await secureSecretStore.setLegacyProviderApiKey(
                providerId,
                apiKey.trim(),
            );
        }
        await hydrate();
    },
        [hydrate],
    );

    const clearProviderApiKey = useCallback(
        async (providerId: string) => {
        if (repositoriesRef.current.providerAccountRepository) {
            const activeAccountId =
                await secureSecretStore.getActiveProviderAccountId(providerId);
            if (activeAccountId) {
                await secureSecretStore.deleteProviderAccountApiKey(activeAccountId);
            }
        } else {
            await secureSecretStore.deleteLegacyProviderApiKey(providerId);
        }
        await hydrate();
    },
        [hydrate],
    );

    const createProviderAccount = useCallback(
        async (
        input: {
        apiKey?: string;
        label: string;
        providerId: string;
        }) => {
        if (!repositoriesRef.current.providerAccountRepository) {
            throw new Error("Provider accounts are not available.");
        }

        const existingAccounts = input.apiKey
            ? await repositoriesRef.current.providerAccountRepository.listByProvider(
                  input.providerId,
              )
            : [];
        const placeholder = (await Promise.all(
            existingAccounts.map(async (account) => ({
                account,
                hasApiKey:
                    Boolean(
                        await secureSecretStore.getProviderAccountApiKey(
                            account.id,
                        ),
                    ),
            })),
        )).find(
            (entry) =>
                entry.account.credentialKind === "apiKey" &&
                !entry.hasApiKey,
        );

        const account = placeholder
            ? placeholder.account
            : await repositoriesRef.current.providerAccountRepository.create({
                  credentialKind: input.apiKey ? "apiKey" : "oauth",
                  providerId: input.providerId,
                  label: input.label,
              });

        if (input.apiKey) {
            await secureSecretStore.setProviderAccountApiKey(
                account.id,
                input.apiKey.trim(),
            );
            if (placeholder) {
                await repositoriesRef.current.providerAccountRepository.updateLabel(
                    account.id,
                    input.label,
                );
            }
            await repositoriesRef.current.configRepository.updateProvider(
                input.providerId,
                { enabled: true },
            );
        }

        // Activate the newly added account
        await secureSecretStore.setActiveProviderAccount(
            input.providerId,
            account.id,
        );

        await hydrate();

        return account;
    },
        [hydrate],
    );

    const switchProviderAccount = useCallback(
        async (
        input: {
        accountId: string;
        providerId: string;
        }) => {
        await secureSecretStore.setActiveProviderAccount(
            input.providerId,
            input.accountId,
        );
        await hydrate();
    },
        [hydrate],
    );

    const setOAuthEmailInSnapshot = useCallback(
        (
        
        providerId: string,
        email: string | null,
        ) => {
        setSnapshot((current) => {
            const providers = current.resolvedConfig.providers.map((provider) =>
                provider.id === providerId
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
    },
        [],
    );

    const persistOAuthEmail = useCallback(
        async (
        
        providerId: string,
        email: string | null,
        ) => {
        try {
            await repositoriesRef.current.configRepository.setProviderOauthEmail(
                providerId,
                email,
            );
        } catch { }
    },
        [],
    );

    const deleteProviderAccount = useCallback(
        async (
        input: {
        accountId: string;
        providerId: string;
        }) => {
        const accountRepo = repositoriesRef.current.providerAccountRepository;

        if (!accountRepo) {
            throw new Error("Provider accounts are not available.");
        }

        const accounts = await accountRepo.listByProvider(input.providerId);
        const target = accounts.find((account) => account.id === input.accountId);
        const remainingAccounts = accounts.filter(
            (account) => account.id !== input.accountId,
        );

        const activeAccountId = await secureSecretStore.getActiveProviderAccountId(
            input.providerId,
        );

        if (target?.credentialKind === "oauth") {
            // OAuth accounts keep their tokens in a per-account session slot
            // rather than the API-key slot, so clear the right store.
            if (getOpenAiOAuthFlavor(input.providerId) === "chatgpt") {
                await clearOpenAiChatGptTokensForAccount(input.accountId);
            } else {
                await clearOpenAiTokensForAccount(input.accountId);
            }
        } else {
            await secureSecretStore.deleteProviderAccountApiKey(input.accountId);
        }
        await accountRepo.delete(input.accountId);

        if (activeAccountId === input.accountId) {
            // Switch active to another account if available
            const nextAccount = remainingAccounts[0] ?? null;
            await secureSecretStore.setActiveProviderAccount(
                input.providerId,
                nextAccount?.id ?? null,
            );
        }

        // Once the last account is gone, drop any legacy session tokens so the
        // provider does not silently report as ready from stale credentials.
        if (
            target?.credentialKind === "oauth" &&
            remainingAccounts.length === 0
        ) {
            if (getOpenAiOAuthFlavor(input.providerId) === "chatgpt") {
                await clearLegacyOpenAiChatGptTokens();
            } else {
                await clearOpenAiTokens();
            }

            setOAuthEmailInSnapshot(input.providerId, null);
            await persistOAuthEmail(input.providerId, null);
        }

        await hydrate();
    },
        [hydrate, persistOAuthEmail, setOAuthEmailInSnapshot],
    );

    const updateProviderAccountLabel = useCallback(
        async (
        input: {
        accountId: string;
        label: string;
        }) => {
        if (!repositoriesRef.current.providerAccountRepository) {
            throw new Error("Provider accounts are not available.");
        }
        await repositoriesRef.current.providerAccountRepository.updateLabel(
            input.accountId,
            input.label,
        );
        await hydrate();
    },
        [hydrate],
    );

    const createMcpServer = useCallback(
        async (
        input: {
        authMode: McpServerAuthMode;
        enabled?: boolean;
        headerValues?: Record<string, string>;
        label: string;
        oauthAllowedAuthOrigin?: string | null;
        oauthAuthorizationUrl?: string | null;
        oauthClientId?: string | null;
        oauthMode?: McpServerOAuthMode;
        oauthScopes?: string | null;
        oauthTokenUrl?: string | null;
        transport: McpServerTransport;
        url: string;
        }) => {
        const server = await repositoriesRef.current.mcpServerRepository.create({
            authMode: input.authMode,
            enabled: input.enabled,
            headerNames: getHeaderNames(input.headerValues),
            label: input.label,
            oauthAllowedAuthOrigin: input.oauthAllowedAuthOrigin,
            oauthAuthorizationUrl: input.oauthAuthorizationUrl,
            oauthClientId: input.oauthClientId,
            oauthMode: input.oauthMode ?? null,
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
    },
        [hydrate],
    );

    const createMcpServerOAuth = useCallback(
        async (
        input: {
        enabled?: boolean;
        label: string;
        oauthAllowedAuthOrigin?: string | null;
        oauthAuthorizationUrl?: string | null;
        oauthClientId?: string | null;
        oauthMode?: McpServerOAuthMode;
        oauthScopes?: string | null;
        oauthTokenUrl?: string | null;
        transport: McpServerTransport;
        url: string;
        }) => {
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
            oauthMode: input.oauthMode ?? null,
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
                    oauthMode: pendingServer.oauthMode,
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
    },
        [hydrate],
    );

    const updateMcpServer = useCallback(
        async (
        
        serverId: string,
        input: {
        authMode?: McpServerAuthMode;
        enabled?: boolean;
        headerValues?: Record<string, string>;
        label?: string;
        oauthAllowedAuthOrigin?: string | null;
        oauthAuthorizationUrl?: string | null;
        oauthClientId?: string | null;
        oauthMode?: McpServerOAuthMode;
        oauthScopes?: string | null;
        oauthTokenUrl?: string | null;
        transport?: McpServerTransport;
        url?: string;
        },
        ) => {
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
            oauthMode: input.oauthMode,
            oauthScopes: input.oauthScopes,
            oauthTokenUrl: input.oauthTokenUrl,
            transport: input.transport,
            url: input.url,
        });

        if (input.headerValues) {
            await secureSecretStore.setMcpHeaderValues(serverId, input.headerValues);
        }

        await hydrate();
    },
        [hydrate],
    );

    const deleteMcpServer = useCallback(
        async (serverId: string) => {
        const session =
            await secureSecretStore.getMcpOAuthSession(serverId);
        const server =
            await repositoriesRef.current.mcpServerRepository.getById(serverId);

        if (server && session?.flowType === "proxy") {
            await revokeProxySession(server).catch((error) =>
                console.error("Failed to revoke MCP proxy session", error),
            );
        }

        await repositoriesRef.current.mcpServerRepository.delete(serverId);
        await Promise.all([
            secureSecretStore.deleteMcpHeaderValues(serverId),
            secureSecretStore.deleteMcpOAuthTokens(serverId),
        ]);
        await hydrate();
    },
        [hydrate],
    );

    const saveMcpServerHeaderValues = useCallback(
        async (
        
        serverId: string,
        headers: Record<string, string>,
        ) => {
        await secureSecretStore.setMcpHeaderValues(serverId, headers);
        await repositoriesRef.current.mcpServerRepository.update(serverId, {
            headerNames: getHeaderNames(headers),
        });
        await hydrate();
    },
        [hydrate],
    );

    const clearMcpServerCredentials = useCallback(
        async (serverId: string) => {
        const session =
            await secureSecretStore.getMcpOAuthSession(serverId);
        const server =
            await repositoriesRef.current.mcpServerRepository.getById(serverId);

        if (server && session?.flowType === "proxy") {
            await revokeProxySession(server).catch((error) =>
                console.error("Failed to revoke MCP proxy session", error),
            );
        }

        await Promise.all([
            secureSecretStore.deleteMcpHeaderValues(serverId),
            secureSecretStore.deleteMcpOAuthTokens(serverId),
        ]);
        await repositoriesRef.current.mcpServerRepository.update(serverId, {
            headerNames: [],
        });
        await hydrate();
    },
        [hydrate],
    );

    const connectMcpServerOAuth = useCallback(
        async (serverId: string) => {
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
    },
        [hydrate],
    );

    const testMcpServer = useCallback(
        async (serverId: string) => {
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
    },
        [hydrate],
    );

    const createModelPreset = useCallback(
        async (
        input: {
        label?: string | null;
        makeDefault?: boolean;
        modelId: string;
        options?: Record<string, unknown> | null;
        providerId: string;
        select?: boolean;
        }) => {
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
    },
        [hydrate],
    );

    const deleteModelPreset = useCallback(
        async (modelPresetId: string) => {
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
    },
        [hydrate],
    );

    const setDefaultModelPreset = useCallback(
        async (modelPresetId: string) => {
        await repositoriesRef.current.configRepository.setDefaultModelPreset(
            modelPresetId,
        );
        await hydrate();
    },
        [hydrate],
    );

    const createSkill = useCallback(
        async (
        input: {
        autoMatch?: boolean;
        description?: string | null;
        enabled?: boolean;
        instructions: string;
        matchKeywords?: string[];
        recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
        recommendedMcpServerIds?: string[];
        title: string;
        }) => {
        const skill = await repositoriesRef.current.skillRepository.create(input);
        await hydrate();
        return skill;
    },
        [hydrate],
    );

    const updateSkill = useCallback(
        async (
        
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
        ) => {
        await repositoriesRef.current.skillRepository.update(skillId, input);
        await hydrate();
    },
        [hydrate],
    );

    const addSkillFiles = useCallback(
        async (
        
        skillId: string,
        files: {
        path: string;
        content: string;
        mimeType?: string | null;
        size?: number | null;
        }[],
        ) => {
        const current =
            await repositoriesRef.current.skillRepository.getById(skillId);

        if (!current) {
            throw new Error(`Skill not found: ${skillId}`);
        }

        const byPath = new Map<string, {
            path: string;
            content: string;
            mimeType: string | null;
            size: number | null;
            id?: string;
        }>(
            current.skillFiles.map((file) => [
                file.path,
                {
                    id: file.id,
                    path: file.path,
                    content: file.content,
                    mimeType: file.mimeType,
                    size: file.size,
                },
            ]),
        );
        let totalBytes = current.skillFiles.reduce(
            (sum, file) => sum + (file.size ?? 0),
            0,
        );

        for (const file of files) {
            if (byPath.has(file.path)) {
                continue;
            }

            if (byPath.size >= SKILL_FILE_MAX_COUNT) {
                break;
            }

            totalBytes += file.size ?? 0;

            if (totalBytes > SKILL_FILE_MAX_TOTAL_BYTES) {
                break;
            }

            byPath.set(file.path, {
                id: undefined,
                path: file.path,
                content: file.content,
                mimeType: file.mimeType ?? null,
                size: file.size ?? null,
            });
        }

        if (byPath.size === current.skillFiles.length) {
            return;
        }

        await repositoriesRef.current.skillRepository.update(skillId, {
            files: Array.from(byPath.values()),
        });
        await hydrate();
    },
        [hydrate],
    );

    const deleteSkill = useCallback(
        async (skillId: string) => {
        await repositoriesRef.current.skillRepository.delete(skillId);
        await hydrate();
    },
        [hydrate],
    );

    const importPlugin = useCallback(
        async (source: string, sourceUrl?: string) => {
        const result = await importPluginSource(source, repositoriesRef.current, sourceUrl);
        if (!result.ok) throw new Error(result.error);
        await hydrate();
        return result.plugin;
    },
        [hydrate],
    );

    const updatePlugin = useCallback(
        async (
        
        pluginId: string,
        input: { enabled?: boolean; options?: Record<string, unknown> | null },
        ) => {
        await repositoriesRef.current.pluginRepository.update(pluginId, input);
        await hydrate();
    },
        [hydrate],
    );

    const deletePlugin = useCallback(
        async (pluginId: string) => {
        const { deletePluginFile } = await import("@/modules/plugins/plugin-files");
        const { secureSecretStore } = await import("@/core/services/secrets");
        deletePluginFile(pluginId);
        await secureSecretStore.deletePluginSecrets(pluginId);
        await repositoriesRef.current.pluginRepository.delete(pluginId);
        await hydrate();
    },
        [hydrate],
    );

    const importSkillMarkdown = useCallback(
        async (
        input: {
        markdown: string;
        replaceById?: string | null;
        sourceUrl?: string | null;
        extraFiles?: string[];
        localFiles?: {
        path: string;
        content: string;
        mimeType: string | null;
        size: number | null;
        }[];
        }) => {
        const parsed = parseSkillMarkdown(input.markdown);
        const discovered = input.sourceUrl
            ? await fetchSkillFiles({
                  sourceUrl: input.sourceUrl,
                  referencedPaths: parsed.files,
                  extraFiles: input.extraFiles,
              })
            : [];
        const byPath = new Map<string, (typeof discovered)[number]>();

        for (const file of discovered) {
            byPath.set(file.path, file);
        }

        for (const file of input.localFiles ?? []) {
            byPath.set(file.path, file);
        }

        const fileInput = Array.from(byPath.values()).map((file) => ({
            path: file.path,
            content: file.content,
            mimeType: file.mimeType,
            size: file.size,
        }));
        let skill: SkillConfig;

        if (input.replaceById) {
            await repositoriesRef.current.skillRepository.update(input.replaceById, {
                autoMatch: parsed.autoMatch,
                description: parsed.description,
                enabled: true,
                files: fileInput,
                instructions: parsed.instructions,
                matchKeywords: parsed.matchKeywords,
                recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
                recommendedMcpServerIds: parsed.recommendedMcpServerIds,
                sourceMarkdown: input.markdown,
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
                files: fileInput,
                instructions: parsed.instructions,
                matchKeywords: parsed.matchKeywords,
                recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
                recommendedMcpServerIds: parsed.recommendedMcpServerIds,
                sourceMarkdown: input.markdown,
                title: parsed.title,
            });
        }

        await hydrate();
        return skill;
    },
        [hydrate],
    );

    const exportSkillMarkdown = useCallback(
        (skillId: string) => {
        const skill = snapshotRef.current.skills.find((item) => item.id === skillId);

        if (!skill) {
            throw new Error(`Skill not found: ${skillId}`);
        }

        return serializeSkillToMarkdown(skill);
    },
        [],
    );

    const createAgent = useCallback(
        async (
        input: {
        description?: string | null;
        mode?: AgentConfig["mode"];
        modelModelId?: string | null;
        modelProviderId?: string | null;
        name: string;
        prompt?: string | null;
        sourceMarkdown?: string | null;
        temperature?: number | null;
        toolPermissions?: AgentConfig["toolPermissions"];
        }) => {
        const name = normalizeAgentName(input.name);
        const existing =
            await repositoriesRef.current.agentRepository.getByName(name);

        if (existing) {
            throw new Error(`An agent named "${name}" already exists.`);
        }

        if (isNativeAgentId(name)) {
            throw new Error(`"${name}" is reserved by a built-in agent.`);
        }

        const agent = await repositoriesRef.current.agentRepository.create({
            ...input,
            name,
            prompt: input.prompt?.trim() || null,
        });
        await hydrate();
        return agent;
    },
        [hydrate],
    );

    const updateAgent = useCallback(
        async (
        
        agentId: string,
        input: {
        description?: string | null;
        enabled?: boolean;
        hidden?: boolean;
        mode?: AgentConfig["mode"];
        modelModelId?: string | null;
        modelProviderId?: string | null;
        name?: string;
        prompt?: string | null;
        sourceMarkdown?: string | null;
        temperature?: number | null;
        toolPermissions?: AgentConfig["toolPermissions"];
        },
        ) => {
        if (input.name !== undefined) {
            const name = normalizeAgentName(input.name);
            const existing =
                await repositoriesRef.current.agentRepository.getByName(name);

            if (existing && existing.id !== agentId) {
                throw new Error(`An agent named "${name}" already exists.`);
            }

            input = { ...input, name };
        }

        await repositoriesRef.current.agentRepository.update(agentId, input);
        await hydrate();
    },
        [hydrate],
    );

    const deleteAgent = useCallback(
        async (agentId: string) => {
        await repositoriesRef.current.agentRepository.delete(agentId);
        await hydrate();
    },
        [hydrate],
    );

    const importAgentMarkdown = useCallback(
        async (
        input: {
        markdown: string;
        replaceById?: string | null;
        }) => {
        const parsed = parseAgentMarkdown(input.markdown);
        let agent: AgentConfig;

        if (input.replaceById) {
            await repositoriesRef.current.agentRepository.update(
                input.replaceById,
                {
                    description: parsed.description,
                    mode: parsed.mode,
                    modelModelId: parsed.modelModelId,
                    modelProviderId: parsed.modelProviderId,
                    name: normalizeAgentName(parsed.name),
                    prompt: parsed.prompt,
                    sourceMarkdown: parsed.sourceMarkdown,
                    temperature: parsed.temperature,
                    toolPermissions: parsed.toolPermissions,
                },
            );
            const replaced =
                await repositoriesRef.current.agentRepository.getById(
                    input.replaceById,
                );

            if (!replaced) {
                throw new Error(`Agent not found: ${input.replaceById}`);
            }

            agent = replaced;
        } else {
            const name = normalizeAgentName(parsed.name);
            const existing =
                await repositoriesRef.current.agentRepository.getByName(name);

            if (existing || isNativeAgentId(name)) {
                throw new Error(`An agent named "${name}" already exists.`);
            }

            agent = await repositoriesRef.current.agentRepository.create({
                description: parsed.description,
                mode: parsed.mode,
                modelModelId: parsed.modelModelId,
                modelProviderId: parsed.modelProviderId,
                name,
                prompt: parsed.prompt,
                sourceMarkdown: parsed.sourceMarkdown,
                temperature: parsed.temperature,
                toolPermissions: parsed.toolPermissions,
            });
        }

        await hydrate();
        return agent;
    },
        [hydrate],
    );

    const exportAgentMarkdown = useCallback(
        (agentId: string) => {
        const agent = snapshotRef.current.agents.find(
            (item) => item.id === agentId,
        );

        if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
        }

        return serializeAgentToMarkdown(agent);
    },
        [],
    );

    const exportConversationJson = useCallback(
        async (conversationId: string) => {
        const conversation =
            await repositoriesRef.current.conversationRepository.getById(
                conversationId,
            );

        if (!conversation) {
            throw new Error(`Chat not found: ${conversationId}`);
        }

        const messages =
            await repositoriesRef.current.messageRepository.listByConversation(
                conversationId,
            );

        return serializeConversationExport(conversation, messages);
    },
        [],
    );

    const importConversationJson = useCallback(
        async (json: string) => {
        const parsed = parseConversationExport(json);

        const conversation =
            await repositoriesRef.current.conversationRepository.create({
                agentId: parsed.conversation.agentId ?? null,
                agentMode: parsed.conversation.agentMode ?? "build",
                modelId: parsed.conversation.modelId ?? null,
                pinnedAt: null,
                providerId: parsed.conversation.providerId ?? null,
                reasoningEffort: parsed.conversation.reasoningEffort ?? "medium",
                selectedFileIds: parsed.conversation.selectedFileIds ?? [],
                selectedMcpServerIds:
                    parsed.conversation.selectedMcpServerIds ?? null,
                selectedSkillIds: parsed.conversation.selectedSkillIds ?? [],
                externalFolderSession:
                    parsed.conversation.externalFolderSession ?? null,
                title:
                    parsed.conversation.title.trim() || "Imported chat",
                archivedAt: null,
            });

        for (let index = 0; index < parsed.messages.length; index += 1) {
            const message = parsed.messages[index];

            await repositoriesRef.current.messageRepository.create({
                conversationId: conversation.id,
                content: message.content,
                error: message.error ?? null,
                metadata: message.metadata ?? null,
                role: message.role,
                sequence: index + 1,
                status: message.status === "streaming" ? "completed" : message.status,
            });
        }

        await hydrate();
        return conversation;
    },
        [hydrate],
    );

    const createSavedPrompt = useCallback(
        async (
        input: {
        content: string;
        title: string;
        }) => {
        const savedPrompt =
            await repositoriesRef.current.savedPromptRepository.create(input);
        await hydrate();
        return savedPrompt;
    },
        [hydrate],
    );

    const updateSavedPrompt = useCallback(
        async (
        
        savedPromptId: string,
        input: {
        content?: string;
        title?: string;
        },
        ) => {
        await repositoriesRef.current.savedPromptRepository.update(
            savedPromptId,
            input,
        );
        await hydrate();
    },
        [hydrate],
    );

    const deleteSavedPrompt = useCallback(
        async (savedPromptId: string) => {
        await repositoriesRef.current.savedPromptRepository.delete(savedPromptId);
        await hydrate();
    },
        [hydrate],
    );

    const writeMemory = useCallback(
        async (content: string) => {
        const memory = await repositoriesRef.current.memoryStore.write(content);
        await hydrate();
        return memory;
    },
        [hydrate],
    );

    const clearMemory = useCallback(
        async () => {
        await repositoriesRef.current.memoryStore.clear();
        await hydrate();
    },
        [hydrate],
    );

    const updateDatabaseSettings = useCallback(
        async (
        input: {
        databaseMode?: AppSettings["databaseMode"];
        databaseUrl?: string | null;
        }) => {
        await repositoriesRef.current.configRepository.setDatabaseSettings(input);
        await hydrate();
    },
        [hydrate],
    );

    const updateBuiltInToolSettings = useCallback(
        async (
        
        input: Partial<BuiltInToolSettings>,
        ) => {
        await repositoriesRef.current.configRepository.setBuiltInToolSettings(
            input,
        );
        await hydrate();
    },
        [hydrate],
    );

    const setConversationApprovalMode = useCallback(
        (conversationId: string, mode: ToolApprovalMode) => {
            const conversationApprovalModes = {
                ...snapshotRef.current.conversationApprovalModes,
                [conversationId]: mode,
            };

            setSnapshot((current) => ({ ...current, conversationApprovalModes }));
            snapshotRef.current = {
                ...snapshotRef.current,
                conversationApprovalModes,
            };

            repositoriesRef.current.configRepository
                .setConversationApprovalModes(conversationApprovalModes)
                .catch((error) => {
                    console.error(
                        "Failed to persist conversation approval mode",
                        error,
                    );
                });
        },
        [],
    );

    const approveToolForChat = useCallback(
        (conversationId: string, toolName: string) => {
            const existing =
                snapshotRef.current.conversationApprovedTools?.[
                    conversationId
                ] ?? [];

            if (existing.includes(toolName)) return;

            const conversationApprovedTools = {
                ...snapshotRef.current.conversationApprovedTools,
                [conversationId]: [...existing, toolName],
            };

            setSnapshot((current) => ({ ...current, conversationApprovedTools }));
            snapshotRef.current = {
                ...snapshotRef.current,
                conversationApprovedTools,
            };

            repositoriesRef.current.configRepository
                .setApprovedToolsByConversation(conversationApprovedTools)
                .catch((error) => {
                    console.error(
                        "Failed to persist approved tools",
                        error,
                    );
                });
        },
        [],
    );

    const updateThemeMode = useCallback(
        async (mode: AppSettings["themeMode"]) => {
        await repositoriesRef.current.configRepository.setThemeMode(mode);
        await hydrate();
    },
        [hydrate],
    );

    const updateMemoryEnabled = useCallback(
        async (enabled: boolean) => {
        await repositoriesRef.current.configRepository.setMemoryEnabled(enabled);
        await hydrate();
    },
        [hydrate],
    );

    const updateNotificationSettings = useCallback(
        async (
        
        input: Partial<AppSettings["notificationSettings"]>,
        ) => {
        await repositoriesRef.current.configRepository.setNotificationSettings(
            input,
        );
        await hydrate();
    },
        [hydrate],
    );



    const readOAuthTokenInfo = useCallback(
        async (providerId: string, accountId: string | null) => {
        if (getOpenAiOAuthFlavor(providerId) === "chatgpt") {
            return accountId
                ? await getOpenAiChatGptTokenInfoForAccount(accountId)
                : await getOpenAiChatGptTokenInfo();
        }

        return accountId
            ? await getOpenAiTokenInfoForAccount(accountId)
            : await getOpenAiTokenInfo();
    },
        [],
    );

    const loginOpenAiOAuthForAccount = useCallback(
        async (
        
        providerId: string,
        accountId: string | null,
        ) => {
        if (getOpenAiOAuthFlavor(providerId) === "chatgpt") {
            await handleChatGptLogin(accountId ? { accountId } : undefined);
        } else {
            await handleLogin(accountId ? { accountId } : undefined);
        }

        const startedAt = Date.now();
        let tokenInfo = await readOAuthTokenInfo(providerId, accountId);

        while (
            !tokenInfo.accessToken &&
            !tokenInfo.refreshToken &&
            Date.now() - startedAt < 20000
        ) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            tokenInfo = await readOAuthTokenInfo(providerId, accountId);
        }

        // The ChatGPT-plan provider ships disabled so it stays hidden until the
        // user signs in. Activate it once a credential actually exists, otherwise
        // the status never leaves "Not set up".
        if (tokenInfo.accessToken || tokenInfo.refreshToken) {
            await repositoriesRef.current.configRepository
                .updateProvider(providerId, { enabled: true })
                .catch(() => { });

            // Accounts are labelled with the signed-in email so switching
            // between multiple sign-ins is unambiguous.
            if (accountId && tokenInfo.email) {
                await repositoriesRef.current.providerAccountRepository
                    ?.updateLabel(accountId, tokenInfo.email)
                    .catch(() => { });
            }
        }

        setOAuthEmailInSnapshot(providerId, tokenInfo.email);
        await persistOAuthEmail(providerId, tokenInfo.email);

        return tokenInfo;
    },
        [persistOAuthEmail, readOAuthTokenInfo, setOAuthEmailInSnapshot],
    );

    /**
     * Stages the OAuth sign-in in the provider's legacy token slot first so a
     * canceled or failed sign-in never leaves a half-created account behind.
     * Once the tokens exist, move them into a real account row.
     */
    const attachLegacyOAuthToAccount = useCallback(
        async (
        
        providerId: string,
        accountId: string,
        ) => {
        const accountRepo = repositoriesRef.current.providerAccountRepository;

        if (getOpenAiOAuthFlavor(providerId) === "chatgpt") {
            const { migrateLegacyOpenAiChatGptTokensToAccount } = await import(
                "@/modules/providers/openai-chatgpt-oauth"
            );
            await migrateLegacyOpenAiChatGptTokensToAccount(accountId);
        } else {
            const { migrateLegacyOpenAiTokensToAccount } = await import(
                "@/modules/providers/openai-oauth"
            );
            await migrateLegacyOpenAiTokensToAccount(accountId);
        }

        const tokenInfo = await readOAuthTokenInfo(providerId, accountId);

        await secureSecretStore.setActiveProviderAccount(providerId, accountId);

        await repositoriesRef.current.configRepository
            .updateProvider(providerId, { enabled: true })
            .catch(() => { });

        if (tokenInfo.email) {
            await accountRepo
                ?.updateLabel(accountId, tokenInfo.email)
                .catch(() => { });
        }

        setOAuthEmailInSnapshot(providerId, tokenInfo.email);
        await persistOAuthEmail(providerId, tokenInfo.email);
    },
        [persistOAuthEmail, readOAuthTokenInfo, setOAuthEmailInSnapshot],
    );

    /**
     * Reuses the credential-less placeholder account the hydrate step creates
     * for a first sign-in, otherwise returns a fresh account. This keeps the
     * first connect from leaving a second empty row behind.
     */
    const resolveOAuthAccountForSignIn = useCallback(
        async (providerId: string) => {
        const accountRepo = repositoriesRef.current.providerAccountRepository;

        if (!accountRepo) {
            return null;
        }

        const accounts = await accountRepo.listByProvider(providerId);

        for (const account of accounts) {
            const tokenInfo = await readOAuthTokenInfo(providerId, account.id);

            if (!tokenInfo.accessToken && !tokenInfo.refreshToken) {
                return account.id;
            }
        }

        const account = await accountRepo.create({
            credentialKind: "oauth",
            providerId,
            label: "Account",
        });

        return account.id;
    },
        [readOAuthTokenInfo],
    );

    const connectOpenAIOAuth = useCallback(
        async (providerId: string = "openai") => {
        await loginOpenAiOAuthForAccount(providerId, null);

        const legacyTokenInfo = await readOAuthTokenInfo(providerId, null);

        if (legacyTokenInfo.accessToken || legacyTokenInfo.refreshToken) {
            const accountId = await resolveOAuthAccountForSignIn(providerId);

            if (accountId) {
                await attachLegacyOAuthToAccount(providerId, accountId);
            }
        }

        await hydrate().catch(() => { });
    },
        [attachLegacyOAuthToAccount, hydrate, loginOpenAiOAuthForAccount, readOAuthTokenInfo, resolveOAuthAccountForSignIn],
    );

    const addOpenAiOAuthAccount = useCallback(
        async (
        input: {
        label?: string;
        providerId: string;
        }) => {
        const accountRepo = repositoriesRef.current.providerAccountRepository;

        if (!accountRepo) {
            throw new Error("Provider accounts are not available.");
        }

        await loginOpenAiOAuthForAccount(input.providerId, null);

        const legacyTokenInfo = await readOAuthTokenInfo(
            input.providerId,
            null,
        );

        if (!legacyTokenInfo.accessToken && !legacyTokenInfo.refreshToken) {
            throw new Error("The sign-in did not return a credential.");
        }

        const account = await accountRepo.create({
            credentialKind: "oauth",
            providerId: input.providerId,
            label: input.label?.trim() || "Account",
        });

        await attachLegacyOAuthToAccount(input.providerId, account.id);

        await hydrate().catch(() => { });
    },
        [attachLegacyOAuthToAccount, hydrate, loginOpenAiOAuthForAccount, readOAuthTokenInfo],
    );

    const disconnectOpenAIOAuth = useCallback(
        async (providerId: string = "openai") => {
        const accountId =
            await secureSecretStore.getActiveProviderAccountId(providerId);
        const flavor = getOpenAiOAuthFlavor(providerId);

        if (accountId) {
            if (flavor === "chatgpt") {
                await clearOpenAiChatGptTokensForAccount(accountId);
            } else {
                await clearOpenAiTokensForAccount(accountId);
            }

            await secureSecretStore.setActiveProviderAccount(providerId, null);
        } else {
            await secureSecretStore.deleteLegacyProviderApiKey(providerId);
        }

        setOAuthEmailInSnapshot(providerId, null);
        await persistOAuthEmail(providerId, null);
        await hydrate().catch(() => { });
    },
        [hydrate, persistOAuthEmail, setOAuthEmailInSnapshot],
    );

    const createConversation = useCallback(async (input?: { agentId?: string | null }) => {
        const currentModel = snapshotRef.current.resolvedConfig.currentModel;
        const now = new Date().toISOString();
        const conversation: Conversation = {
            agentId: input?.agentId ?? null,
            agentMode: "build",
            archivedAt: null,
            createdAt: now,
            externalFolderSession: null,
            id: Crypto.randomUUID(),
            modelId: currentModel?.modelId ?? null,
            pinnedAt: null,
            providerId: currentModel?.providerId ?? null,
            reasoningEffort: "medium",
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
            agentId: conversation.agentId,
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

    const deleteConversation = useCallback(
        async (conversationId: string) => {
        await repositoriesRef.current.pendingInputRepository
            .deleteByConversation(conversationId)
            .catch(() => {});
        await repositoriesRef.current.conversationRepository.deleteById(
            conversationId,
        );
        await hydrate();
    },
        [hydrate],
    );

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

    const renameConversation = useCallback(
        async (conversationId: string, title: string) => {
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
    },
        [],
    );

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

    const createWorkspaceFile = useCallback(
        async (input: { content: string; name: string }) => {
        const file = await workspaceServiceRef.current.createTextFile(input);

        setSnapshot((current) => ({
            ...current,
            workspaceFiles: upsertWorkspaceFiles(current.workspaceFiles, [file]),
        }));

        await refreshWorkspaceFiles();
        return file;
    },
        [refreshWorkspaceFiles],
    );

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

    const selectConversation = useCallback(
        async (conversationId: string) => {
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
    },
        [],
    );

    const resolveNotificationApproval = useCallback(
        async (
        input: {
        approvalId: string;
        decision: import("@/modules/runtime/run-manager").ToolApprovalDecision;
        runId: string;
        }) => {
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
    },
        [selectConversation, resolvePendingToolApproval],
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

            fileSelectionRevisionRef.current += 1;
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

    const setConversationAgent = useCallback(
        async (conversationId: string, agentIdOrName: string | null) => {
            const target = snapshotRef.current.conversations.find(
                (conversation) => conversation.id === conversationId,
            );

            if (!target) {
                return;
            }

            const agent = resolveConversationAgent(
                snapshotRef.current,
                agentIdOrName ?? target.agentId,
            );

            await ensureConversationPersisted(target);

            await repositoriesRef.current.conversationRepository.updateMetadata(
                conversationId,
                { agentId: agent.id },
            );

            const nextAgentId = agent.id;

            setSnapshot((current) => ({
                ...current,
                conversations: current.conversations.map((conversation) =>
                    conversation.id === conversationId
                        ? { ...conversation, agentId: nextAgentId }
                        : conversation,
                ),
                currentConversation:
                    current.currentConversation?.id === conversationId
                        ? { ...current.currentConversation, agentId: nextAgentId }
                        : current.currentConversation,
                currentSelectedAgentId:
                    current.currentConversation?.id === conversationId
                        ? nextAgentId
                        : current.currentSelectedAgentId,
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

    const failOrphanedStreamingMessage = useCallback(
        async (
        
        runId: string,
        errorMessage: string,
        ) => {
        const run =
            await repositoriesRef.current.agentRunRepository.getById(runId);
        if (!run) {
            return;
        }
        console.error("[failOrphanedStreamingMessage] failing orphaned stream", {
            runId,
            assistantMessageId: run.assistantMessageId,
        });
        await repositoriesRef.current.messageRepository.updateContent({
            id: run.assistantMessageId,
            content: "",
            error: errorMessage,
            status: "failed",
        });
        setSnapshot((current) => ({
            ...current,
            messages:
                current.currentConversation?.id === run.conversationId
                    ? current.messages.map((message) =>
                          message.id === run.assistantMessageId &&
                          message.status === "streaming"
                              ? {
                                    ...message,
                                    content: "",
                                    error: errorMessage,
                                    status: "failed" as const,
                                }
                              : message,
                      )
                    : current.messages,
        }));
    },
        [],
    );

    const executeAgentRun = useCallback(
        async (runId: string) => {
        const registry = runRegistryRef.current;
        if (!registry.claim(runId)) {
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
                runRegistry: registry,
                workspaceService: workspaceServiceRef.current,
                updateRunRecord,
                requestToolApproval,
                requestRunQuestionnaire,
                requestSecretAnswer: requestRunSecret,
                generateAndApplyConversationTitle,
                notifyRunStateChange,
                ui,
                onSkillsChange: () => {
                    hydrate().catch(() => {});
                },
                onPluginsChange: () => {
                    hydrate().catch(() => {});
                },
                onAgentsChange: () => {
                    hydrate().catch(() => {});
                },
                retryRun: (retryRunId, delayMs) => {
                    setTimeout(() => {
                        if (registry.isDisposed()) return;
                        executeAgentRun(retryRunId).catch(() => {});
                    }, delayMs);
                },
                shouldKeepBackgroundAgentAlive: () =>
                    runRegistryRef.current.hasActiveRuns(),
                refreshScheduler,
                spawnSubagent: (task) =>
                    executeSubagentTask(deps, task),
                pluginRuntimeSnapshot: pluginRuntimeRef.current.snapshot(runId),
            };

            await executeClaimedAgentRun(runId, deps);
        } catch (error) {
            if (registry.isDisposed()) return;
            console.error("[executeAgentRun] run threw", { runId, error });
            registry.clear(runId);
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : "The run terminated unexpectedly. Send again to retry.";
            await failOrphanedStreamingMessage(runId, errorMessage).catch(
                () => {},
            );
            throw error;
        } finally {
            // Run settled (completed/failed/cancelled): promote anything the
            // user steered or queued while it was busy.
            if (!registry.isDisposed()) {
                promoteAfterRunRef.current(runId);
            }
        }
    },
        [failOrphanedStreamingMessage, generateAndApplyConversationTitle, hydrate, notifyRunStateChange, refreshScheduler, requestRunQuestionnaire, requestRunSecret, requestToolApproval, updateRunRecord],
    );
    executeAgentRunRef.current = executeAgentRun;

    useEffect(() => {
        const pendingRunIds = pendingAgentRunIdsRef.current;
        pendingAgentRunIdsRef.current = [];
        for (const pendingRunId of pendingRunIds) {
            void executeAgentRunRef.current(pendingRunId).catch(() => {});
        }
    });


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
        // Don't overwrite the assistant message here. The running agent loop
        // owns message persistence and will keep any streamed partial text
        // when it observes the abort. Overwriting with "Stopped." here races
        // with that flush and discards the partial response.
    }, [updateRunRecord]);

    const stopSending = useCallback(async () => {
        await cancelRun({
            conversationId: snapshotRef.current.currentConversation?.id,
        });
    }, [cancelRun]);

    /**
     * Admits a prompt submitted while the conversation's run is busy into
     * the pending-input inbox (opencode-style): "steer" is injected into the
     * active run at its next safe step boundary, "queue" becomes the next
     * normal turn once the chat is idle. Rows are deleted on delivery or
     * cancellation, so nothing lingers after it has been used.
     */
    const admitPendingInput = useCallback(
        async (input: {
            content: string;
            conversationId: string;
            delivery: PendingInputDelivery;
            externalFolderSession: ExternalFolderSession | null;
            fileContextSource: FileContextSource;
            selectedFileIds: string[];
        }) => {
            const repositories = repositoriesRef.current;
            const metadata: import("@/core/types/app-state").MessageMetadata = {};

            if (
                input.selectedFileIds.length > 0 ||
                input.fileContextSource === "external-folder"
            ) {
                metadata.externalFolderDisplayName =
                    input.externalFolderSession?.displayName ?? null;
                metadata.fileContextSource = input.fileContextSource;
                if (input.selectedFileIds.length > 0) {
                    metadata.selectedFileIds = input.selectedFileIds;
                }
            }

            const pendingInput = await repositories.pendingInputRepository.create(
                {
                    content: input.content,
                    conversationId: input.conversationId,
                    delivery: input.delivery,
                    metadata: Object.keys(metadata).length > 0 ? metadata : null,
                },
            );

            setSnapshot((current) => ({
                ...current,
                pendingInputs: [...current.pendingInputs, pendingInput],
            }));

            return pendingInput;
        },
        [],
    );

    const cancelPendingInput = useCallback(async (pendingInputId: string) => {
        try {
            await repositoriesRef.current.pendingInputRepository.delete(
                pendingInputId,
            );
        } catch (error) {
            console.warn("Failed to cancel pending input.", error);
        }

        setSnapshot((current) => ({
            ...current,
            pendingInputs: current.pendingInputs.filter(
                (item) => item.id !== pendingInputId,
            ),
        }));
    }, []);

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
        const activeConversation = input.conversationId
            ? (snapshotRef.current.conversations.find(
                  (item) => item.id === input.conversationId,
              ) ?? null)
            : snapshotRef.current.currentConversation;
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
                delivery: input.delivery ?? "queue",
            });
            // Busy conversation: don't fail — admit the prompt to the
            // pending-input inbox. "steer" injects into the active run at
            // its next step boundary; "queue" waits as the next turn.
            setError(null);
            await admitPendingInput({
                content: cleanContent,
                conversationId: conversation.id,
                delivery: input.delivery ?? "queue",
                externalFolderSession,
                fileContextSource,
                selectedFileIds,
            });
            return;
        }

        if (!currentModel) {
            failSend("No active model available. Configure a provider first.");
        }

        const conversationAgent = resolveConversationAgent(
            snapshotRef.current,
            conversation.agentId,
        );
        let model =
            currentModel ??
            failSend("No active model available. Configure a provider first.");

        if (conversationAgent.modelProviderId && conversationAgent.modelModelId) {
            const overrideModel =
                snapshotRef.current.resolvedConfig.availableModels.find(
                    (item) =>
                        item.providerId ===
                            conversationAgent.modelProviderId &&
                        item.modelId === conversationAgent.modelModelId,
                );

            if (!overrideModel) {
                failSend(
                    `Agent "${conversationAgent.name}" is configured to use ${conversationAgent.modelProviderId}/${conversationAgent.modelModelId}, which is unavailable. Enable that provider or pick a different agent.`,
                );
            } else {
                model = overrideModel;
            }
        }

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

        const audioFiles = binaryFiles.filter((file) =>
            isAudioMimeType(file.mimeType),
        );
        const videoFiles = binaryFiles.filter((file) =>
            isVideoMimeType(file.mimeType),
        );
        const otherBinaryFiles = binaryFiles.filter(
            (file) =>
                !isAudioMimeType(file.mimeType) &&
                !isVideoMimeType(file.mimeType),
        );

        if (
            audioFiles.length > 0 &&
            !model.supportsAudioInput &&
            !model.supportsTools
        ) {
            failSend(
                "The current model does not support audio input. Switch to an audio-capable model, or use a tool-capable model with transcribeAudio / analyzeAudio.",
            );
        }

        if (
            videoFiles.length > 0 &&
            !model.supportsVideoInput &&
            !model.supportsTools
        ) {
            failSend(
                "The current model does not support video input. Switch to a video-capable model, or use a tool-capable model with getVideoFrame.",
            );
        }

        if (
            (otherBinaryFiles.length > 0 || fileContextSource === "external-folder") &&
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
            agentId: conversation.agentId,
            agentMode: isPlanAgent(conversationAgent) ? "plan" : "build",
            assistantMessageId,
            autoApprove: false,
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
                agentId: conversation.agentId,
                agentMode: isPlanAgent(conversationAgent) ? "plan" : "build",
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
            console.error("[sendMessage] run dispatch failed", {
                runId: agentRun.id,
                error: runError,
            });
            setError(
                runError instanceof Error ? runError.message : "Failed to start run.",
            );
        });
    }, [admitPendingInput, ensureConversationPersisted]);

    /**
     * Promotes one pending input once the chat has no active run: stranded
     * steers first (they outlived the run they were aimed at), then the
     * oldest queued item — one per run, like opencode. Each promotion
     * removes its row, so the chain terminates when the inbox is empty.
     */
    const promotePendingInputs = useCallback(
        async (conversationId: string) => {
            const repositories = repositoriesRef.current;
            try {
                const activeRun =
                    await repositories.agentRunRepository.getActiveByConversation(
                        conversationId,
                    );
                if (activeRun) {
                    return;
                }

                const pending =
                    await repositories.pendingInputRepository.listByConversation(
                        conversationId,
                    );
                if (pending.length === 0) {
                    return;
                }

                const next =
                    pending.find((item) => item.delivery === "steer") ??
                    pending[0];
                await repositories.pendingInputRepository.delete(next.id);
                setSnapshot((current) => ({
                    ...current,
                    pendingInputs: current.pendingInputs.filter(
                        (item) => item.id !== next.id,
                    ),
                }));

                await sendMessage({
                    content: next.content,
                    conversationId,
                    fileContextSource: next.metadata?.fileContextSource,
                    selectedFileIds: next.metadata?.selectedFileIds ?? [],
                });
            } catch (error) {
                console.warn("Failed to promote pending input.", error);
            }
        },
        [sendMessage],
    );

    /**
     * After a run settles (completed, failed, or cancelled), hand the inbox
     * to the next turn instead of stranding whatever was steered/queued.
     */
    const promoteAfterRun = useCallback(
        (runId: string) => {
            if (runRegistryRef.current.isDisposed()) {
                return;
            }
            void (async () => {
                const run =
                    snapshotRef.current.agentRuns.find(
                        (item) => item.id === runId,
                    ) ??
                    (await repositoriesRef.current.agentRunRepository.getById(
                        runId,
                    ));
                if (!run) {
                    return;
                }
                await promotePendingInputs(run.conversationId);
            })().catch(() => {
                // Promotion is best-effort; rows stay in the DB for the
                // next completion or boot pass.
            });
        },
        [promotePendingInputs],
    );
    promoteAfterRunRef.current = promoteAfterRun;

    /**
     * Boot-time sweep: pending inputs whose conversation has no run at all
     * (the app was killed after the run finished) are promoted immediately.
     * Conversations with active/resumable runs are skipped — those runs
     * drain the inbox through their own completion hook.
     */
    const promoteBootPendingInputs = useCallback(async () => {
        const repositories = repositoriesRef.current;
        try {
            const pending =
                await repositories.pendingInputRepository.listAll();
            const conversationIds = Array.from(
                new Set(pending.map((item) => item.conversationId)),
            );

            for (const conversationId of conversationIds) {
                const activeRun =
                    await repositories.agentRunRepository.getActiveByConversation(
                        conversationId,
                    );
                if (activeRun) {
                    continue;
                }
                await promotePendingInputs(conversationId);
            }
        } catch (error) {
            console.warn("Failed to promote pending inputs on boot.", error);
        }
    }, [promotePendingInputs]);
    promoteBootPendingInputsRef.current = promoteBootPendingInputs;

    const retryRun = useCallback(
        async (runId: string) => {
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
    },
        [executeAgentRun],
    );

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
    const pendingSecretRequest =
        pendingSecretRequests.find(
            (secretRequest) =>
                secretRequest.conversationId ===
                snapshot.currentConversation?.id,
        ) ?? null;

    // Split contexts: chat state churns per token, config on user edits,
    // app/boot almost never. Consumers re-render only when a context they
    // read changes identity — settings screens skip streaming churn.
    const chatValue = useMemo(
        (): ChatContextValue => ({
            resolveNotificationApproval,
            approvePendingToolApproval: () => {
                if (pendingToolApproval) {
                    resolvePendingToolApproval(pendingToolApproval, "approve");
                }
            },
            approvePendingToolApprovalForChat: () => {
                if (pendingToolApproval) {
                    const { conversationId, toolName } = pendingToolApproval;
                    const existing =
                        snapshotRef.current.conversationApprovedTools?.[
                            conversationId
                        ] ?? [];

                    if (!existing.includes(toolName)) {
                        const conversationApprovedTools = {
                            ...snapshotRef.current.conversationApprovedTools,
                            [conversationId]: [...existing, toolName],
                        };

                        setSnapshot((current) => ({
                            ...current,
                            conversationApprovedTools,
                        }));
                        snapshotRef.current = {
                            ...snapshotRef.current,
                            conversationApprovedTools,
                        };

                        repositoriesRef.current.configRepository
                            .setApprovedToolsByConversation(
                                conversationApprovedTools,
                            )
                            .catch((error) => {
                                console.error(
                                    "Failed to persist approved tools",
                                    error,
                                );
                            });
                    }

                    resolvePendingToolApproval(pendingToolApproval, "approve");
                }
            },
            approveToolForChat,
            agentRuns: snapshot.agentRuns,
            cancelRun,
            clearConversationFolder,
            createConversation,
            importConversationJson,
            exportConversationJson,
            currentConversation: snapshot.currentConversation,
            currentExternalFolderSession:
                snapshot.currentConversation?.externalFolderSession ?? null,
            currentSelectedAgentId: snapshot.currentSelectedAgentId,
            currentSelectedFileIds: snapshot.currentSelectedFileIds,
            currentSelectedSkillIds: snapshot.currentSelectedSkillIds,
            deleteConversation,
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
            pendingSecretRequest,
            submitPendingSecretRequest,
            dismissPendingSecretRequest,
            messages: snapshot.messages,
            editAndResendMessage,
            pickConversationFolder,
            renameConversation,
            resumePendingRuns,
            retryRun,
            runStatusByConversation,
            selectConversation,
            setConversationPinned,
            sendMessage,
            sending,
            stopSending,
            pendingInputs: snapshot.pendingInputs,
            cancelPendingInput,
            reasoningEffort:
                snapshot.currentConversation?.reasoningEffort ?? "medium",
            setReasoningEffort,
            conversationAgentName: resolveConversationAgent(
                { agents: snapshot.agents },
                snapshot.currentSelectedAgentId,
            ).name,
            setConversationAgent,
            setCurrentSelectedFileIds,
            setCurrentSelectedSkillIds,
            conversations: snapshot.conversations,
        }),
        [approveToolForChat, cancelPendingInput, cancelRun, clearConversationFolder, createConversation, deleteConversation, dismissPendingSecretRequest, editAndResendMessage, exportConversationJson, importConversationJson, pendingQuestionnaire, pendingSecretRequest, pendingToolApproval, pickConversationFolder, renameConversation, resolveNotificationApproval, resolvePendingQuestionnaire, resolvePendingToolApproval, resumePendingRuns, retryRun, runStatusByConversation, selectConversation, sendMessage, sending, setConversationAgent, setCurrentSelectedFileIds, setCurrentSelectedSkillIds, setReasoningEffort, snapshot.agentRuns, snapshot.agents, snapshot.conversations, snapshot.currentConversation, snapshot.currentSelectedAgentId, snapshot.currentSelectedFileIds, snapshot.currentSelectedSkillIds, snapshot.messages, snapshot.pendingInputs, stopSending, submitPendingSecretRequest],
    );
    const configValue = useMemo(
        (): ConfigContextValue => ({
            clearMcpServerCredentials,
            clearProviderApiKey,
            connectMcpServerOAuth,
            connectOpenAIOAuth,
            addOpenAiOAuthAccount,
            createProviderAccount,
            switchProviderAccount,
            deleteProviderAccount,
            updateProviderAccountLabel,
            activeProviderAccountIds: snapshot.activeProviderAccountIds,
            providerAccounts: snapshot.providerAccounts,
            createMcpServer,
            createMcpServerOAuth,
            writeMemory,
            createProvider,
            createModelPreset,
            createSavedPrompt,
            createSchedule,
            createSkill,
            createAgent,
            updateAgent,
            deleteAgent,
            importAgentMarkdown,
            exportAgentMarkdown,
            currentSelectedMcpServerIds: snapshot.currentSelectedMcpServerIds,
            agents: snapshot.agents,
            deleteProvider,
            deleteSchedule,
            deleteMcpServer,
            clearMemory,
            deleteModelPreset,
            deleteSavedPrompt,
            deleteSkill,
            deletePlugin,
            disconnectOpenAIOAuth,
            importSkillMarkdown,
            importPlugin,
            exportSkillMarkdown,
            runPluginAction: (pluginId, name, args, onProgress) =>
                pluginRuntimeRef.current
                    .snapshot("app")
                    .runAction(pluginId, name, args, onProgress),
            runPluginTool: (pluginId, name, args, onProgress) =>
                pluginRuntimeRef.current
                    .snapshot("app")
                    .runTool(pluginId, name, args, onProgress),
            pluginActions,
            pluginTools,
            savedPrompts: snapshot.savedPrompts,
            memory: snapshot.memory,
            mcpServers: snapshot.mcpServers,
            refreshScheduler,
            resolvedConfig: snapshot.resolvedConfig,
            saveProviderApiKey,
            saveMcpServerHeaderValues,
            schedules: snapshot.schedules,
            selectModel,
            setCurrentSelectedMcpServerIds,
            setDefaultModelPreset,
            settings: snapshot.settings,
            skills: snapshot.skills,
            plugins: snapshot.plugins,
            testMcpServer,
            conversationApprovalModes: snapshot.conversationApprovalModes,
            conversationApprovedTools: snapshot.conversationApprovedTools,
            updateMcpServer,
            updateDatabaseSettings,
            updateBuiltInToolSettings,
            updateMemoryEnabled,
            updateSavedPrompt,
            updateSchedule,
            updateSchedulingEnabled,
            updateSkill,
            updatePlugin,
            addSkillFiles,
            setConversationApprovalMode,
            updateThemeMode,
            updateProvider,
            clearWorkspaceFiles,
            createWorkspaceFile,
            deleteWorkspaceFile,
            importFiles,
            refreshWorkspaceFiles,
            workspaceFiles: snapshot.workspaceFiles,
        }),
        [addOpenAiOAuthAccount, addSkillFiles, clearMcpServerCredentials, clearMemory, clearProviderApiKey, clearWorkspaceFiles, connectMcpServerOAuth, connectOpenAIOAuth, createAgent, createMcpServer, createMcpServerOAuth, createModelPreset, createProvider, createProviderAccount, createSavedPrompt, createSchedule, createSkill, createWorkspaceFile, deleteAgent, deleteMcpServer, deleteModelPreset, deletePlugin, deleteProvider, deleteProviderAccount, deleteSavedPrompt, deleteSchedule, deleteSkill, deleteWorkspaceFile, disconnectOpenAIOAuth, exportAgentMarkdown, exportSkillMarkdown, importAgentMarkdown, importFiles, importPlugin, importSkillMarkdown, pluginActions, pluginTools, refreshScheduler, refreshWorkspaceFiles, saveMcpServerHeaderValues, saveProviderApiKey, selectModel, setConversationApprovalMode, setCurrentSelectedMcpServerIds, setDefaultModelPreset, snapshot.activeProviderAccountIds, snapshot.agents, snapshot.conversationApprovalModes, snapshot.conversationApprovedTools, snapshot.currentSelectedMcpServerIds, snapshot.mcpServers, snapshot.memory, snapshot.plugins, snapshot.providerAccounts, snapshot.resolvedConfig, snapshot.savedPrompts, snapshot.schedules, snapshot.settings, snapshot.skills, snapshot.workspaceFiles, switchProviderAccount, testMcpServer, updateAgent, updateBuiltInToolSettings, updateDatabaseSettings, updateMcpServer, updateMemoryEnabled, updatePlugin, updateProvider, updateProviderAccountLabel, updateSavedPrompt, updateSchedule, updateSchedulingEnabled, updateSkill, updateThemeMode, writeMemory],
    );
    const appValue = useMemo(
        (): AppContextValue => ({
            updateNotificationSettings,
            dismissInAppNotification,
            error,
            hydrating,
            inAppNotification,
            modelDiscoveryInProgress,
            ready,
            refresh,
        }),
        [dismissInAppNotification, error, hydrating, inAppNotification, modelDiscoveryInProgress, ready, refresh, updateNotificationSettings],
    );
    return (
        <ChatStateContext.Provider value={chatValue}>
            <ConfigStateContext.Provider value={configValue}>
                <AppStateContext.Provider value={appValue}>
                    <ThemePreferenceController mode={snapshot.settings.themeMode} />
                    {children}
                </AppStateContext.Provider>
            </ConfigStateContext.Provider>
        </ChatStateContext.Provider>
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
    const app = useAppStateContext();
    const chat = useChatStateContext();

    return {
        dismissInAppNotification: app.dismissInAppNotification,
        ready: app.ready,
        hydrating: app.hydrating,
        modelDiscoveryInProgress: app.modelDiscoveryInProgress,
        inAppNotification: app.inAppNotification,
        sending: chat.sending,
        error: app.error,
        refresh: app.refresh,
        stopSending: chat.stopSending,
    };
}

export function useConfig() {
    const config = useConfigStateContext();
    const app = useAppStateContext();

    return {
        ...config.resolvedConfig,
        clearMcpServerCredentials: config.clearMcpServerCredentials,
        clearProviderApiKey: config.clearProviderApiKey,
        createProviderAccount: config.createProviderAccount,
        switchProviderAccount: config.switchProviderAccount,
        deleteProviderAccount: config.deleteProviderAccount,
        updateProviderAccountLabel: config.updateProviderAccountLabel,
        activeProviderAccountIds: config.activeProviderAccountIds,
        providerAccounts: config.providerAccounts,
        connectMcpServerOAuth: config.connectMcpServerOAuth,
        connectOpenAIOAuth: config.connectOpenAIOAuth,
        addOpenAiOAuthAccount: config.addOpenAiOAuthAccount,
        createMcpServer: config.createMcpServer,
        createMcpServerOAuth: config.createMcpServerOAuth,
        writeMemory: config.writeMemory,
        createProvider: config.createProvider,
        createModelPreset: config.createModelPreset,
        createSavedPrompt: config.createSavedPrompt,
        createSkill: config.createSkill,
        importPlugin: config.importPlugin,
        importSkillMarkdown: config.importSkillMarkdown,
        exportSkillMarkdown: config.exportSkillMarkdown,
        pluginActions: config.pluginActions,
        pluginTools: config.pluginTools,
        runPluginAction: config.runPluginAction,
        runPluginTool: config.runPluginTool,
        agents: config.agents,
        createAgent: config.createAgent,
        updateAgent: config.updateAgent,
        deleteAgent: config.deleteAgent,
        importAgentMarkdown: config.importAgentMarkdown,
        exportAgentMarkdown: config.exportAgentMarkdown,
        createWorkspaceFile: config.createWorkspaceFile,
        deleteMcpServer: config.deleteMcpServer,
        deleteProvider: config.deleteProvider,
        clearMemory: config.clearMemory,
        deleteModelPreset: config.deleteModelPreset,
        deleteSavedPrompt: config.deleteSavedPrompt,
        deleteSkill: config.deleteSkill,
        deletePlugin: config.deletePlugin,
        deleteWorkspaceFile: config.deleteWorkspaceFile,
        disconnectOpenAIOAuth: config.disconnectOpenAIOAuth,
        currentSelectedMcpServerIds: config.currentSelectedMcpServerIds,
        setCurrentSelectedMcpServerIds: config.setCurrentSelectedMcpServerIds,
        currentModelSupportsImageGeneration:
            config.resolvedConfig.currentModelSupportsImageGeneration,
        currentModelSupportsImageInput:
            config.resolvedConfig.currentModelSupportsImageInput,
        currentModelSupportsAudioInput:
            config.resolvedConfig.currentModelSupportsAudioInput,
        currentModelSupportsVideoInput:
            config.resolvedConfig.currentModelSupportsVideoInput,
        currentModelSupportsTools: config.resolvedConfig.currentModelSupportsTools,
        importFiles: config.importFiles,
        memory: config.memory,
        memoryEnabled: config.settings.memoryEnabled,
        mcpServers: config.mcpServers,
        selectModel: config.selectModel,
        saveMcpServerHeaderValues: config.saveMcpServerHeaderValues,
        saveProviderApiKey: config.saveProviderApiKey,
        savedPrompts: config.savedPrompts,
        schedules: config.schedules,
        createSchedule: config.createSchedule,
        updateSchedule: config.updateSchedule,
        deleteSchedule: config.deleteSchedule,
        schedulingEnabled: config.settings.schedulingEnabled,
        updateSchedulingEnabled: config.updateSchedulingEnabled,
        setDefaultModelPreset: config.setDefaultModelPreset,
        skills: config.skills,
        plugins: config.plugins,
        refresh: app.refresh,
        refreshWorkspaceFiles: config.refreshWorkspaceFiles,
        testMcpServer: config.testMcpServer,
        themeMode: config.settings.themeMode,
        conversationApprovalModes: config.conversationApprovalModes,
        conversationApprovedTools: config.conversationApprovedTools,
        toolSettings: config.settings.builtInToolSettings,
        updateDatabaseSettings: config.updateDatabaseSettings,
        updateMcpServer: config.updateMcpServer,
        updateBuiltInToolSettings: config.updateBuiltInToolSettings,
        updateMemoryEnabled: config.updateMemoryEnabled,
        updateSavedPrompt: config.updateSavedPrompt,
        updateSkill: config.updateSkill,
        updatePlugin: config.updatePlugin,
        addSkillFiles: config.addSkillFiles,
        setConversationApprovalMode: config.setConversationApprovalMode,
        updateThemeMode: config.updateThemeMode,
        notificationSettings: config.settings.notificationSettings,
        updateNotificationSettings: app.updateNotificationSettings,
        updateProvider: config.updateProvider,
    };
}

export function useChat() {
    const chat = useChatStateContext();
    const config = useConfigStateContext();
    const currentConversationRunStatus = chat.currentConversation
        ? (chat.runStatusByConversation[chat.currentConversation.id] ?? null)
        : null;

    return {
        agentRuns: chat.agentRuns,
        conversations: chat.conversations,
        cancelRun: chat.cancelRun,
        currentConversationRunStatus,
        currentConversation: chat.currentConversation,
        currentExternalFolderSession: chat.currentExternalFolderSession,
        currentSelectedMcpServerIds: config.currentSelectedMcpServerIds,
        currentSelectedSkillIds: chat.currentSelectedSkillIds,
        pendingToolApproval: chat.pendingToolApproval,
        approvePendingToolApproval: chat.approvePendingToolApproval,
        approvePendingToolApprovalForChat: chat.approvePendingToolApprovalForChat,
        approveToolForChat: chat.approveToolForChat,
        denyPendingToolApproval: chat.denyPendingToolApproval,
        pendingQuestionnaire: chat.pendingQuestionnaire,
        submitPendingQuestionnaire: chat.submitPendingQuestionnaire,
        dismissPendingQuestionnaire: chat.dismissPendingQuestionnaire,
        pendingSecretRequest: chat.pendingSecretRequest,
        submitPendingSecretRequest: chat.submitPendingSecretRequest,
        dismissPendingSecretRequest: chat.dismissPendingSecretRequest,
        resolveNotificationApproval: chat.resolveNotificationApproval,
        createConversation: chat.createConversation,
        createSavedPrompt: config.createSavedPrompt,
        createWorkspaceFile: config.createWorkspaceFile,
        clearConversationFolder: chat.clearConversationFolder,
        clearWorkspaceFiles: config.clearWorkspaceFiles,
        deleteWorkspaceFile: config.deleteWorkspaceFile,
        currentSelectedFileIds: chat.currentSelectedFileIds,
        importFiles: config.importFiles,
        messages: chat.messages,
        editAndResendMessage: chat.editAndResendMessage,
        savedPrompts: config.savedPrompts,
        pickConversationFolder: chat.pickConversationFolder,
        resumePendingRuns: chat.resumePendingRuns,
        retryRun: chat.retryRun,
        renameConversation: chat.renameConversation,
        runStatusByConversation: chat.runStatusByConversation,
        selectConversation: chat.selectConversation,
        setConversationPinned: chat.setConversationPinned,
        sendMessage: chat.sendMessage,
        pendingInputs: chat.pendingInputs,
        cancelPendingInput: chat.cancelPendingInput,
        skills: config.skills,
        updateSavedPrompt: config.updateSavedPrompt,
        deleteSavedPrompt: config.deleteSavedPrompt,
        sending:
            currentConversationRunStatus === "queued" ||
            currentConversationRunStatus === "running" ||
            currentConversationRunStatus === "waiting_for_approval" ||
            currentConversationRunStatus === "waiting_for_question" ||
            currentConversationRunStatus === "resumable" ||
            currentConversationRunStatus === "retrying",
        stopSending: chat.stopSending,
        reasoningEffort: chat.reasoningEffort,
        setReasoningEffort: chat.setReasoningEffort,
        agents: config.agents,
        currentSelectedAgentId: chat.currentSelectedAgentId,
        conversationAgentName: chat.conversationAgentName,
        setConversationAgent: chat.setConversationAgent,
        createAgent: config.createAgent,
        updateAgent: config.updateAgent,
        deleteAgent: config.deleteAgent,
        importAgentMarkdown: config.importAgentMarkdown,
        exportAgentMarkdown: config.exportAgentMarkdown,
        importConversationJson: chat.importConversationJson,
        exportConversationJson: chat.exportConversationJson,
        setCurrentSelectedFileIds: chat.setCurrentSelectedFileIds,
        setCurrentSelectedMcpServerIds: config.setCurrentSelectedMcpServerIds,
        setCurrentSelectedSkillIds: chat.setCurrentSelectedSkillIds,
        refreshWorkspaceFiles: config.refreshWorkspaceFiles,
        workspaceFiles: config.workspaceFiles,
        deleteConversation: chat.deleteConversation,
    };
}
