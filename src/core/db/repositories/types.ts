import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import type { schema } from "@/core/db/schema";
import type { MemoryStore } from "@/modules/memory/types";
import type {
  AgentConfig,
  AgentMode,
  AgentRun,
  AgentRunStatus,
  AppSettings,
  BuiltInToolSettings,
  Conversation,
  DatabaseMode,
  ExternalFolderSession,
  FileContextSource,
  McpServerAuthMode,
  McpServerConfig,
  McpServerStatus,
  McpServerTransport,
  MessageMetadata,
  ModelPreset,
  NotificationSettings,
  ProviderConfig,
  ReasoningEffort,
  SavedPrompt,
  Schedule,
  ScheduleRun,
  ScheduleRunStatus,
  SkillConfig,
  SkillFile,
  StoredMessage,
  ToolApprovalMode,
  ThemeMode,
  WorkspaceFile,
  WorkspaceFileSourceKind,
} from "@/core/types/app-state";

export interface AgentRepository {
  create(input: {
    description?: string | null;
    enabled?: boolean;
    hidden?: boolean;
    id?: string;
    mode?: AgentConfig["mode"];
    modelModelId?: string | null;
    modelProviderId?: string | null;
    name: string;
    prompt?: string | null;
    sourceMarkdown?: string | null;
    temperature?: number | null;
    toolPermissions?: AgentConfig["toolPermissions"];
  }): Promise<AgentConfig>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<AgentConfig | null>;
  getByName(name: string): Promise<AgentConfig | null>;
  list(): Promise<AgentConfig[]>;
  update(
    id: string,
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
  ): Promise<void>;
}

export interface ConversationRepository {
  deleteById(id: string): Promise<void>;
  create(input: {
    agentId?: string | null;
    id?: string;
    modelId?: string | null;
    pinnedAt?: string | null;
    providerId?: string | null;
    title: string;
  }): Promise<Conversation>;
  getById(id: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  updateMetadata(
    id: string,
    input: {
      agentId?: string | null;
      agentMode?: AgentMode;
      externalFolderSession?: ExternalFolderSession | null;
      modelId?: string | null;
      pinnedAt?: string | null;
      providerId?: string | null;
      reasoningEffort?: ReasoningEffort;
      selectedFileIds?: string[];
      selectedMcpServerIds?: string[] | null;
      selectedSkillIds?: string[];
      title?: string;
      updatedAt?: string;
    },
  ): Promise<void>;
}

export interface MessageRepository {
  create(input: {
    content: string;
    conversationId: string;
    error?: string | null;
    id?: string;
    metadata?: MessageMetadata | null;
    role: StoredMessage["role"];
    sequence: number;
    status: StoredMessage["status"];
  }): Promise<StoredMessage>;
  getNextSequence(conversationId: string): Promise<number>;
  listByConversation(conversationId: string): Promise<StoredMessage[]>;
  listStreaming(): Promise<StoredMessage[]>;
  recoverInterruptedStreams(): Promise<void>;
  updateContent(input: {
    content: string;
    error?: string | null;
    id: string;
    metadata?: MessageMetadata | null;
    status?: StoredMessage["status"];
  }): Promise<void>;
}

export interface AgentRunRepository {
  create(input: {
    agentId?: string | null;
    agentMode?: AgentMode;
    assistantMessageId: string;
    autoApprove?: boolean;
    completedAt?: string | null;
    conversationId: string;
    externalFolderSession?: ExternalFolderSession | null;
    fileContextSource?: FileContextSource | null;
    id?: string;
    input: string;
    lastError?: string | null;
    modelId: string;
    providerId: string;
    resumeCount?: number;
    retryCount?: number;
    maxRetries?: number;
    lastRetryAt?: string | null;
    selectedFileIds?: string[];
    startedAt?: string;
    status: AgentRunStatus;
    updatedAt?: string;
    userMessageId: string;
  }): Promise<AgentRun>;
  getById(id: string): Promise<AgentRun | null>;
  getActiveByConversation(conversationId: string): Promise<AgentRun | null>;
  list(): Promise<AgentRun[]>;
  update(
    id: string,
    input: {
  agentId?: string | null;
  agentMode?: AgentMode;
  completedAt?: string | null;
  externalFolderSession?: ExternalFolderSession | null;
  fileContextSource?: FileContextSource | null;
  input?: string;
  lastError?: string | null;
  modelId?: string;
  providerId?: string;
  resumeCount?: number;
  retryCount?: number;
  maxRetries?: number;
  lastRetryAt?: string | null;
  selectedFileIds?: string[];
  startedAt?: string;
  status?: AgentRunStatus;
  updatedAt?: string;
  autoApprove?: boolean;
  }): Promise<void>;
}

export interface WorkspaceRepository {
  create(input: {
    displayName: string;
    id?: string;
    mimeType?: string | null;
    originalName?: string | null;
    relativePath: string;
    size?: number | null;
    sourceKind: WorkspaceFileSourceKind;
  }): Promise<WorkspaceFile>;
  getById(id: string): Promise<WorkspaceFile | null>;
  getByIds(ids: string[]): Promise<WorkspaceFile[]>;
  list(): Promise<WorkspaceFile[]>;
  deleteAll(): Promise<void>;
  delete(id: string): Promise<void>;
  updateMetadata(
    id: string,
    input: {
      displayName?: string;
      mimeType?: string | null;
      originalName?: string | null;
      relativePath?: string;
      size?: number | null;
      updatedAt?: string;
    },
  ): Promise<void>;
}

export interface McpServerRepository {
  create(input: {
    authMode: McpServerAuthMode;
    enabled?: boolean;
    headerNames?: string[];
    id?: string;
    label: string;
    oauthAllowedAuthOrigin?: string | null;
    oauthAuthorizationUrl?: string | null;
    oauthClientId?: string | null;
    oauthScopes?: string | null;
    oauthTokenUrl?: string | null;
    transport: McpServerTransport;
    url: string;
  }): Promise<McpServerConfig>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<McpServerConfig | null>;
  list(): Promise<McpServerConfig[]>;
  update(
    id: string,
    input: {
      authMode?: McpServerAuthMode;
      enabled?: boolean;
      headerNames?: string[];
      label?: string;
      oauthAllowedAuthOrigin?: string | null;
      oauthAuthorizationUrl?: string | null;
      oauthClientId?: string | null;
      oauthScopes?: string | null;
      oauthTokenUrl?: string | null;
      transport?: McpServerTransport;
      url?: string;
    },
  ): Promise<void>;
  updateConnectionState(
    id: string,
    input: {
      lastError?: string | null;
      lastStatus: McpServerStatus;
      serverInfo?: Record<string, unknown> | null;
      serverInstructions?: string | null;
      toolCount?: number | null;
    },
  ): Promise<void>;
}

export interface SkillRepository {
  create(input: {
    autoMatch?: boolean;
    description?: string | null;
    enabled?: boolean;
    id?: string;
    instructions: string;
    matchKeywords?: string[];
    recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
    recommendedMcpServerIds?: string[];
    sourceMarkdown?: string | null;
    title: string;
    files?: {
      path: string;
      content: string;
      mimeType?: string | null;
      size?: number | null;
      id?: string;
    }[];
  }): Promise<SkillConfig>;
  delete(id: string): Promise<void>;

  getById(id: string): Promise<SkillConfig | null>;
  list(): Promise<SkillConfig[]>;
  update(
    id: string,
    input: {
      autoMatch?: boolean;
      description?: string | null;
      enabled?: boolean;
      instructions?: string;
      matchKeywords?: string[];
      recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
      recommendedMcpServerIds?: string[];
      sourceMarkdown?: string | null;
      title?: string;
      files?: {
        path: string;
        content: string;
        mimeType?: string | null;
        size?: number | null;
        id?: string;
      }[];
    },
  ): Promise<void>;
  listFilesForSkill(skillId: string): Promise<SkillFile[]>;
  deleteFilesForSkill(skillId: string): Promise<void>;
}

export interface SavedPromptRepository {
  create(input: {
    content: string;
    id?: string;
    title: string;
  }): Promise<SavedPrompt>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<SavedPrompt | null>;
  list(): Promise<SavedPrompt[]>;
  update(
    id: string,
    input: {
      content?: string;
      title?: string;
    },
  ): Promise<void>;
}

export interface ScheduleRepository {
  create(input: {
    autoApprove?: boolean;
    conversationId?: string | null;
    enabled?: boolean;
    expression: string;
    externalFolderSession?: ExternalFolderSession | null;
    agentId?: string | null;
    id?: string;
    lastRunAt?: string | null;
    modelId: string;
    nextRunAt?: string | null;
    prompt: string;
    providerId: string;
    timezone: string;
    title: string;
  }): Promise<Schedule>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<Schedule | null>;
  list(): Promise<Schedule[]>;
  listEnabled(): Promise<Schedule[]>;
  update(
    id: string,
    input: {
      agentId?: string | null;
      autoApprove?: boolean;
      conversationId?: string | null;
      enabled?: boolean;
      expression?: string;
      externalFolderSession?: ExternalFolderSession | null;
      lastRunAt?: string | null;
      modelId?: string;
      nextRunAt?: string | null;
      prompt?: string;
      providerId?: string;
      timezone?: string;
      title?: string;
    },
  ): Promise<void>;
}

export interface ScheduleRunRepository {
  create(input: {
    completedAt?: string | null;
    error?: string | null;
    id?: string;
    runId?: string | null;
    scheduleId: string;
    startedAt?: string;
    status: ScheduleRunStatus;
  }): Promise<ScheduleRun>;
  getById(id: string): Promise<ScheduleRun | null>;
  listBySchedule(scheduleId: string, limit?: number): Promise<ScheduleRun[]>;
  update(
    id: string,
    input: {
      completedAt?: string | null;
      error?: string | null;
      runId?: string | null;
      status?: ScheduleRunStatus;
    },
  ): Promise<void>;
}

export interface ConfigRepository {
  createProvider(input: {
    authType: ProviderConfig["authType"];
    baseUrl?: string | null;
    enabled?: boolean;
    family: ProviderConfig["family"];
    id: string;
    label: string;
    oauthAccountEmail?: string | null;
  }): Promise<ProviderConfig>;
  deleteProvider(providerId: string): Promise<void>;
  ensureDefaultProviders(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  listModelPresets(): Promise<ModelPreset[]>;
  listProviderConfigs(): Promise<ProviderConfig[]>;
  createModelPreset(input: {
    label?: string | null;
    makeDefault?: boolean;
    modelId: string;
    options?: Record<string, unknown> | null;
    providerId: string;
  }): Promise<ModelPreset>;
  deleteModelPreset(modelPresetId: string): Promise<void>;
  setDatabaseSettings(input: {
    databaseMode?: DatabaseMode;
    databaseUrl?: string | null;
  }): Promise<void>;
  setBuiltInToolSettings(input: Partial<BuiltInToolSettings>): Promise<void>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setSchedulingEnabled(enabled: boolean): Promise<void>;
  setThemeMode(mode: ThemeMode): Promise<void>;
  setToolApprovalMode(mode: ToolApprovalMode): Promise<void>;
  setMaxToolSteps(maxToolSteps: number): Promise<void>;
  setNotificationSettings(input: Partial<NotificationSettings>): Promise<void>;
  setDefaultModelPreset(modelPresetId: string): Promise<void>;
  updateProvider(
    providerId: string,
    input: {
      baseUrl?: string | null;
      enabled?: boolean;
      label?: string;
      oauthAccountEmail?: string | null;
    },
  ): Promise<void>;
  setProviderOauthEmail(
    providerId: string,
    email: string | null,
  ): Promise<void>;
  setSetting(key: string, value: string | null): Promise<void>;
}

export type Repositories = {
  agentRepository: AgentRepository;
  agentRunRepository: AgentRunRepository;
  configRepository: ConfigRepository;
  conversationRepository: ConversationRepository;
  memoryStore: MemoryStore;
  mcpServerRepository: McpServerRepository;
  messageRepository: MessageRepository;
  savedPromptRepository: SavedPromptRepository;
  scheduleRepository: ScheduleRepository;
  scheduleRunRepository: ScheduleRunRepository;
  skillRepository: SkillRepository;
  workspaceRepository: WorkspaceRepository;
};

export type AppDatabase = ExpoSQLiteDatabase<typeof schema>;
export type SqliteDb = SQLiteDatabase;
