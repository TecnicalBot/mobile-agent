import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type {
  AgentMode,
  AgentRunStatus,
  ExternalFolderSession,
  FileContextSource,
  MessageMetadata,
  MessageRole,
  MessageStatus,
  McpServerAuthMode,
  McpServerStatus,
  McpServerTransport,
  ProviderAuthType,
  ProviderFamily,
  ReasoningEffort,
  BuiltInToolKey,
  ScheduleRunStatus,
  WorkspaceFileSourceKind,
} from "@/core/types/app-state";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    reasoningEffort: text("reasoning_effort")
      .$type<ReasoningEffort>()
      .notNull()
      .default("medium"),
    agentMode: text("agent_mode").$type<AgentMode>().notNull().default("build"),
    selectedFileIds: text("selected_file_ids_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    selectedMcpServerIds: text("selected_mcp_server_ids_json", {
      mode: "json",
    }).$type<string[] | null>(),
    selectedSkillIds: text("selected_skill_ids_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    externalFolderSession: text("external_folder_session_json", { mode: "json" })
      .$type<ExternalFolderSession | null>(),
    pinnedAt: text("pinned_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [index("idx_conversations_updated_at").on(table.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull(),
    metadata: text("metadata_json", { mode: "json" }).$type<MessageMetadata | null>(),
    status: text("status").$type<MessageStatus>().notNull(),
    error: text("error"),
    sequence: integer("sequence").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_messages_conversation_sequence").on(
      table.conversationId,
      table.sequence,
    ),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey().notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    status: text("status").$type<AgentRunStatus>().notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    input: text("input").notNull(),
    fileContextSource: text("file_context_source").$type<FileContextSource | null>(),
    selectedFileIds: text("selected_file_ids_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    externalFolderSession: text("external_folder_session_json", {
      mode: "json",
    }).$type<ExternalFolderSession | null>(),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    resumeCount: integer("resume_count").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    lastRetryAt: text("last_retry_at"),
    agentMode: text("agent_mode").$type<AgentMode>().notNull().default("build"),
    autoApprove: integer("auto_approve", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("idx_agent_runs_conversation_updated_at").on(
      table.conversationId,
      table.updatedAt,
    ),
    index("idx_agent_runs_status_updated_at").on(table.status, table.updatedAt),
  ],
);

export const workspaceFiles = sqliteTable(
  "workspace_files",
  {
    id: text("id").primaryKey().notNull(),
    displayName: text("display_name").notNull(),
    originalName: text("original_name"),
    mimeType: text("mime_type"),
    size: integer("size"),
    relativePath: text("relative_path").notNull(),
    sourceKind: text("source_kind").$type<WorkspaceFileSourceKind>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("workspace_files_relative_path_unique").on(table.relativePath)],
);

export const providerConfigs = sqliteTable("provider_configs", {
  id: text("id").primaryKey().notNull(),
  family: text("family").$type<ProviderFamily>().notNull(),
  label: text("label").notNull(),
  authType: text("auth_type").$type<ProviderAuthType>().notNull(),
  baseUrl: text("base_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  oauthAccountEmail: text("oauth_account_email"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const modelPresets = sqliteTable(
  "model_presets",
  {
    id: text("id").primaryKey().notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    label: text("label"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    options: text("options_json", { mode: "json" }).$type<
      Record<string, unknown> | null
    >(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("model_presets_provider_id_model_id_unique").on(
      table.providerId,
      table.modelId,
    ),
  ],
);

export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey().notNull(),
    label: text("label").notNull(),
    url: text("url").notNull(),
    transport: text("transport").$type<McpServerTransport>().notNull(),
    authMode: text("auth_mode").$type<McpServerAuthMode>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    headerNames: text("header_names_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    oauthClientId: text("oauth_client_id"),
    oauthAuthorizationUrl: text("oauth_authorization_url"),
    oauthTokenUrl: text("oauth_token_url"),
    oauthScopes: text("oauth_scopes"),
    oauthAllowedAuthOrigin: text("oauth_allowed_auth_origin"),
    lastStatus: text("last_status").$type<McpServerStatus>().notNull().default("untested"),
    lastError: text("last_error"),
    toolCount: integer("tool_count"),
    serverInfo: text("server_info_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    serverInstructions: text("server_instructions"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_mcp_servers_updated_at").on(table.updatedAt)],
);

export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    sourceMarkdown: text("source_markdown"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    autoMatch: integer("auto_match", { mode: "boolean" }).notNull().default(false),
    matchKeywords: text("match_keywords_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    recommendedMcpServerIds: text("recommended_mcp_server_ids_json", {
      mode: "json",
    })
      .$type<string[]>()
      .notNull()
      .default([]),
    recommendedBuiltInToolKeys: text("recommended_built_in_tool_keys_json", {
      mode: "json",
    })
      .$type<BuiltInToolKey[]>()
      .notNull()
      .default([]),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_skills_updated_at").on(table.updatedAt)],
);

export const savedPrompts = sqliteTable(
  "saved_prompts",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_saved_prompts_updated_at").on(table.updatedAt)],
);

export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    expression: text("expression").notNull(),
    timezone: text("timezone").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    autoApprove: integer("auto_approve", { mode: "boolean" })
      .notNull()
      .default(true),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    conversationId: text("conversation_id"),
    externalFolderSession: text("external_folder_session_json", {
      mode: "json",
    }).$type<ExternalFolderSession | null>(),
    lastRunAt: text("last_run_at"),
    nextRunAt: text("next_run_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_schedules_enabled_next_run_at").on(
      table.enabled,
      table.nextRunAt,
    ),
    index("idx_schedules_updated_at").on(table.updatedAt),
  ],
);

export const scheduleRuns = sqliteTable(
  "schedule_runs",
  {
    id: text("id").primaryKey().notNull(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    status: text("status").$type<ScheduleRunStatus>().notNull(),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_schedule_runs_schedule_started_at").on(
      table.scheduleId,
      table.startedAt,
    ),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey().notNull(),
    content: text("content").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sourceConversationId: text("source_conversation_id"),
    sourceMessageId: text("source_message_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [index("idx_memories_updated_at").on(table.updatedAt)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey().notNull(),
  value: text("value"),
});

export const schema = {
  agentRuns,
  appSettings,
  conversations,
  memories,
  messages,
  mcpServers,
  modelPresets,
  providerConfigs,
  savedPrompts,
  scheduleRuns,
  schedules,
  skills,
  workspaceFiles,
};
