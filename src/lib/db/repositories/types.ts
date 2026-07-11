import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import type { schema } from "@/lib/db/schema";
import type {
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
  MemoryEntry,
  MessageMetadata,
  ModelPreset,
  ProviderConfig,
  SkillConfig,
  StoredMessage,
  ToolApprovalMode,
  WorkspaceFile,
  WorkspaceFileSourceKind,
} from "@/types/app-state";

export interface ConversationRepository {
  deleteById(id: string): Promise<void>;
  create(input: {
    modelId?: string | null;
    providerId?: string | null;
    title: string;
  }): Promise<Conversation>;
  getById(id: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  updateMetadata(
    id: string,
    input: {
      externalFolderSession?: ExternalFolderSession | null;
      modelId?: string | null;
      providerId?: string | null;
      selectedFileIds?: string[];
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
    assistantMessageId: string;
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
      completedAt?: string | null;
      externalFolderSession?: ExternalFolderSession | null;
      fileContextSource?: FileContextSource | null;
      input?: string;
      lastError?: string | null;
      modelId?: string;
      providerId?: string;
      resumeCount?: number;
      selectedFileIds?: string[];
      startedAt?: string;
      status?: AgentRunStatus;
      updatedAt?: string;
    },
  ): Promise<void>;
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
    title: string;
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
      title?: string;
    },
  ): Promise<void>;
}

export interface MemoryRepository {
  archive(id: string): Promise<void>;
  create(input: {
    content: string;
    enabled?: boolean;
    id?: string;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
  }): Promise<MemoryEntry>;
  getById(id: string): Promise<MemoryEntry | null>;
  list(input?: { includeArchived?: boolean }): Promise<MemoryEntry[]>;
  update(
    id: string,
    input: {
      content?: string;
      enabled?: boolean;
      sourceConversationId?: string | null;
      sourceMessageId?: string | null;
    },
  ): Promise<void>;
}

export interface ConfigRepository {
  createProvider(input: {
    authType: ProviderConfig["authType"];
    baseUrl?: string | null;
    family: ProviderConfig["family"];
    id: string;
    label: string;
    oauthAccountEmail?: string | null;
  }): Promise<ProviderConfig>;
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
  setToolApprovalMode(mode: ToolApprovalMode): Promise<void>;
  setMaxToolSteps(maxToolSteps: number): Promise<void>;
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
  agentRunRepository: AgentRunRepository;
  configRepository: ConfigRepository;
  conversationRepository: ConversationRepository;
  memoryRepository: MemoryRepository;
  mcpServerRepository: McpServerRepository;
  messageRepository: MessageRepository;
  skillRepository: SkillRepository;
  workspaceRepository: WorkspaceRepository;
};

export type AppDatabase = ExpoSQLiteDatabase<typeof schema>;
export type SqliteDb = SQLiteDatabase;
