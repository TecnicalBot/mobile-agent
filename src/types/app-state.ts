export type ProviderFamily =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "openai-compatible";

export type ProviderAuthType = "oauth" | "apiKey";
export type DatabaseMode = "local" | "remote";
export type FileContextSource = "workspace" | "external-folder";
export type MessageRole = "system" | "user" | "assistant";
export type MessageStatus = "streaming" | "completed" | "failed";
export type ModelKind = "chat" | "small";
export type ModelRef = `${string}/${string}`;
export type ModelTransport =
  | "anthropic"
  | "codexResponses"
  | "google"
  | "openaiChat"
  | "openaiCompatible"
  | "openaiResponses";
export type ToolApprovalMode = "ask" | "auto";
export type McpServerTransport = "http" | "sse";
export type McpServerAuthMode = "none" | "headers" | "oauth";
export type McpServerStatus = "untested" | "connected" | "failed";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "canceled"
  | "resumable";
export type WorkspaceFileSourceKind = "imported" | "created";
export type ExternalFolderPlatform = "android" | "ios" | "web";
export type BuiltInToolKey =
  | "workspaceListFiles"
  | "workspaceReadFile"
  | "workspaceWriteFile"
  | "workspaceCreateFile"
  | "folderListDirectory"
  | "folderReadFile"
  | "folderWriteFile"
  | "folderCreateFile"
  | "folderCreateDirectory"
  | "folderRenameEntry"
  | "folderMoveEntry"
  | "folderDeleteEntry";
export type BuiltInToolSettings = Record<BuiltInToolKey, boolean>;
export type SkillConfig = {
  id: string;
  title: string;
  description: string | null;
  instructions: string;
  enabled: boolean;
  autoMatch: boolean;
  matchKeywords: string[];
  recommendedMcpServerIds: string[];
  recommendedBuiltInToolKeys: BuiltInToolKey[];
  createdAt: string;
  updatedAt: string;
};
export type MemoryEntry = {
  id: string;
  content: string;
  enabled: boolean;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
export type MemoryEvent = {
  id: string;
  kind: "created" | "updated" | "deleted";
  memoryId: string;
  content: string;
  previousContent: string | null;
  reason: string | null;
  createdAt: string;
};
export type PendingToolApprovalRequest = {
  id: string;
  inputSummary: string;
  toolName: string;
};
export type PendingToolApproval = PendingToolApprovalRequest & {
  chatTitle: string;
  conversationId: string;
  runId: string;
};
export type ModelUsageSnapshot = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costInput: number | null;
  costOutput: number | null;
  costTotal: number | null;
  contextWindow: number | null;
  remainingContext: number | null;
  contextUsagePercent: number | null;
};

export type ModelCapabilities = {
  imageGeneration: boolean;
  imageInput: boolean;
  tools: boolean;
};

export type GeneratedImageAttachment = {
  id: string;
  mimeType: string;
  uri: string;
};

export type ToolExecutionRecord = {
  toolName: string;
  status: "completed" | "failed";
  inputSummary: string;
  outputSummary: string | null;
  error: string | null;
  createdAt: string;
};

export type PromptArtifact = {
  id: string;
  category: "model" | "tool";
  fileId: string;
  displayName: string;
  relativePath: string;
  createdAt: string;
};

export type ExecutionTimelineEvent = {
  id: string;
  kind: "run" | "prompt" | "tool" | "image";
  status: "pending" | "completed" | "failed" | "info";
  title: string;
  detail: string | null;
  createdAt: string;
};

export type MessageMetadata = {
  appliedSkillIds?: string[];
  executionTimeline?: ExecutionTimelineEvent[];
  externalFolderDisplayName?: string | null;
  fileContextSource?: FileContextSource;
  generatedImages?: GeneratedImageAttachment[];
  memoryEvents?: MemoryEvent[];
  promptArtifacts?: PromptArtifact[];
  runId?: string | null;
  selectedFileIds?: string[];
  toolExecutions?: ToolExecutionRecord[];
  usage?: ModelUsageSnapshot | null;
};

export type AgentRun = {
  id: string;
  conversationId: string;
  status: AgentRunStatus;
  userMessageId: string;
  assistantMessageId: string;
  providerId: string;
  modelId: string;
  input: string;
  fileContextSource: FileContextSource | null;
  selectedFileIds: string[];
  externalFolderSession: ExternalFolderSession | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  resumeCount: number;
};

export type ExternalFolderSession = {
  uri: string;
  displayName: string;
  platform: ExternalFolderPlatform;
  sourceType: "external-folder";
  grantedAt: string;
};

export type ProviderConfig = {
  id: string;
  family: ProviderFamily;
  label: string;
  authType: ProviderAuthType;
  baseUrl: string | null;
  enabled: boolean;
  oauthAccountEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerConfig = {
  id: string;
  label: string;
  url: string;
  transport: McpServerTransport;
  authMode: McpServerAuthMode;
  enabled: boolean;
  headerNames: string[];
  oauthClientId: string | null;
  oauthAuthorizationUrl: string | null;
  oauthTokenUrl: string | null;
  oauthScopes: string | null;
  oauthAllowedAuthOrigin: string | null;
  lastStatus: McpServerStatus;
  lastError: string | null;
  toolCount: number | null;
  serverInfo: Record<string, unknown> | null;
  serverInstructions: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelPreset = {
  id: string;
  providerId: string;
  modelId: string;
  label: string | null;
  isDefault: boolean;
  options: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null;
  selectedFileIds: string[];
  selectedSkillIds: string[];
  externalFolderSession: ExternalFolderSession | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: MessageMetadata | null;
  status: MessageStatus;
  error: string | null;
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceFile = {
  id: string;
  displayName: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  relativePath: string;
  sourceKind: WorkspaceFileSourceKind;
  createdAt: string;
  updatedAt: string;
};

export type SendMessageInput = {
  content: string;
  fileContextSource?: FileContextSource;
  selectedFileIds?: string[];
};

export type AppSettings = {
  activeConversationId: string | null;
  activeModelRef: ModelRef | null;
  builtInToolSettings: BuiltInToolSettings;
  databaseMode: DatabaseMode;
  databaseUrl: string | null;
  memoryEnabled: boolean;
  maxToolSteps: number;
  toolApprovalMode: ToolApprovalMode;
};

export type CuratedModelDefinition = {
  capabilities?: Partial<ModelCapabilities>;
  id: string;
  kind: ModelKind;
  label: string;
  outputType?: "image" | "text";
  options?: Record<string, unknown>;
  transport?: ModelTransport;
};

export type ResolvedModel = {
  capabilities: ModelCapabilities;
  ref: ModelRef;
  providerId: string;
  providerFamily: ProviderFamily;
  providerAuthType: ProviderAuthType;
  providerLabel: string;
  modelId: string;
  label: string;
  outputType: "image" | "text";
  isDefault: boolean;
  source: "suggested" | "custom";
  active: boolean;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsImageGeneration: boolean;
  transport: ModelTransport;
  options: Record<string, unknown> | null;
};

export type ResolvedConfig = {
  activeProviderIds: string[];
  providers: ProviderConfig[];
  modelPresets: ModelPreset[];
  suggestedModelsByProvider: Record<string, CuratedModelDefinition[]>;
  availableModels: ResolvedModel[];
  activeModels: ResolvedModel[];
  currentModel: ResolvedModel | null;
  currentModelSupportsImageGeneration: boolean;
  currentModelSupportsImageInput: boolean;
  currentModelSupportsTools: boolean;
  databaseMode: DatabaseMode;
  databaseUrl: string | null;
};

export type AppStateSnapshot = {
  agentRuns: AgentRun[];
  conversations: Conversation[];
  currentConversation: Conversation | null;
  currentSelectedFileIds: string[];
  currentSelectedSkillIds: string[];
  memories: MemoryEntry[];
  mcpServers: McpServerConfig[];
  messages: StoredMessage[];
  skills: SkillConfig[];
  workspaceFiles: WorkspaceFile[];
  resolvedConfig: ResolvedConfig;
  settings: AppSettings;
};

export function createModelRef(providerId: string, modelId: string): ModelRef {
  return `${providerId}/${modelId}`;
}

export function parseModelRef(modelRef: ModelRef) {
  const separatorIndex = modelRef.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === modelRef.length - 1) {
    throw new Error(`Invalid model ref: ${modelRef}`);
  }

  return {
    providerId: modelRef.slice(0, separatorIndex),
    modelId: modelRef.slice(separatorIndex + 1),
  };
}
