import type {
  AgentConfig,
  Conversation,
  ModelRef,
  PendingToolApproval,
  ResolvedModel,
  StoredMessage,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import type { ToolPreviewContentPart } from "@/modules/tools/tool-preview";
import { presentHarnessToolExecution } from "@/modules/harnesses/tool-execution";
import type {
  AcpContentBlock,
  AcpModel,
  AcpNewSessionResult,
  AcpPermissionOption,
  AcpPermissionRequest,
  AcpSessionConfigOption,
  AcpSessionMode,
  AcpSessionModeState,
  AcpSessionUpdate,
  AcpToolCall,
  AcpToolCallContent,
} from "./antigravity";

export const ANTIGRAVITY_PROVIDER_ID = "harness:antigravity";

export const antigravityModelRef = (modelId: string): ModelRef =>
  `harness:antigravity/${encodeURIComponent(modelId)}`;

export type AntigravitySessionState = {
  id: string;
  title: string;
  cwd: string;
  modelId: string | null;
  modeId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  models: AcpModel[];
  modes: AcpSessionModeState | null;
  configOptions: AcpSessionConfigOption[];
  running: boolean;
  currentAssistantId: string | null;
  currentAssistantMessageID: string | null;
  openReasoningID: string | null;
  openReasoningMessageID: string | null;
  stopReason: string | null;
};

function nowISO() {
  return new Date().toISOString();
}

function assistantMetadata(): NonNullable<StoredMessage["metadata"]> {
  return {
    agentName: "Antigravity",
    toolExecutions: [],
    reasoning: [],
    toolRunAnchors: [],
  };
}

function newMessage(
  state: AntigravitySessionState,
  role: StoredMessage["role"],
  content: string,
  id: string,
  createdAt: string,
  metadata: StoredMessage["metadata"] = null,
  status: StoredMessage["status"] = "completed",
): StoredMessage {
  return {
    id,
    conversationId: state.id,
    role,
    content,
    metadata,
    status,
    error: null,
    sequence: state.messages.length,
    createdAt,
    updatedAt: createdAt,
  };
}

function replaceMessage(
  state: AntigravitySessionState,
  id: string,
  update: (message: StoredMessage) => StoredMessage,
): AntigravitySessionState {
  const index = state.messages.findIndex((message) => message.id === id);
  if (index < 0) return state;
  const next = [...state.messages];
  next[index] = update(next[index]);
  return { ...state, messages: next, updatedAt: next[index].updatedAt };
}

function closeOpenReasoning(
  state: AntigravitySessionState,
  completedAt: string,
): AntigravitySessionState {
  const id = state.openReasoningID;
  const messageID = state.openReasoningMessageID;
  if (!id || !messageID) return state;
  const next = replaceMessage(state, messageID, (message) => ({
    ...message,
    metadata: {
      ...message.metadata,
      reasoning: (message.metadata?.reasoning ?? []).map((block) =>
        block.id === id && !block.completedAt
          ? { ...block, completedAt }
          : block,
      ),
    },
    updatedAt: completedAt,
  }));
  return {
    ...next,
    openReasoningID: null,
    openReasoningMessageID: null,
  };
}

function ensureAssistant(
  state: AntigravitySessionState,
  messageID: string | null | undefined,
  createdAt: string,
): { state: AntigravitySessionState; messageID: string } {
  const acpMessageID = messageID ?? null;
  if (
    state.currentAssistantId &&
    (!acpMessageID || acpMessageID === state.currentAssistantMessageID)
  ) {
    return { state, messageID: state.currentAssistantId };
  }
  const localID = `acp:${state.id}:assistant:${state.messages.length}`;
  return {
    state: {
      ...state,
      messages: [
        ...state.messages,
        newMessage(
          state,
          "assistant",
          "",
          localID,
          createdAt,
          assistantMetadata(),
          state.running ? "streaming" : "completed",
        ),
      ],
      currentAssistantId: localID,
      currentAssistantMessageID: acpMessageID,
      openReasoningID: null,
      openReasoningMessageID: null,
      updatedAt: createdAt,
    },
    messageID: localID,
  };
}

function contentText(content: AcpContentBlock | undefined): string {
  if (!content) return "";
  if (content.type === "text") return content.text;
  if (content.type === "resource" && "text" in content.resource)
    return content.resource.text;
  return "";
}

function toolContentParts(
  content: AcpToolCallContent[] | undefined,
): ToolPreviewContentPart[] {
  const parts: ToolPreviewContentPart[] = [];
  for (const item of content ?? []) {
    if (item.type === "content") {
      const block = item.content;
      if (block.type === "text") {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        parts.push({
          type: "file",
          uri: `data:${block.mimeType};base64,${block.data}`,
          mime: block.mimeType,
          name: "image",
        });
      } else if (block.type === "resource") {
        parts.push({
          type: "text",
          text:
            "text" in block.resource
              ? block.resource.text
              : `[resource] ${block.resource.uri}`,
        });
      } else if (block.type === "resource_link") {
        parts.push({
          type: "text",
          text: `[resource] ${block.name || block.uri}`,
        });
      }
    } else if (item.type === "diff") {
      parts.push({
        type: "text",
        text: `[diff] ${item.path}\n${item.newText}`,
      });
    } else if (item.type === "terminal") {
      parts.push({ type: "text", text: `[terminal] ${item.terminalId}` });
    }
  }
  return parts;
}

function toolStatus(
  status: string | undefined,
): ToolExecutionRecord["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function updateToolExecution(
  state: AntigravitySessionState,
  tool: AcpToolCall,
  phase: "call" | "update",
  createdAt: string,
): AntigravitySessionState {
  const assistant = ensureAssistant(state, null, createdAt);
  const messageID = assistant.messageID;
  const executionID = `acp-tool-${tool.toolCallId}`;
  const current = assistant.state.messages.find(
    (message) => message.id === messageID,
  );
  if (!current) return assistant.state;
  const existing = (current.metadata?.toolExecutions ?? []).find(
    (execution) => execution.id === executionID,
  );
  const contentParts = tool.content ? toolContentParts(tool.content) : [];
  // An empty update must not erase output from an earlier notification.
  const content = contentParts.length ? contentParts : null;
  const hasInput = tool.rawInput !== undefined;
  const status = tool.status
    ? toolStatus(tool.status)
    : (existing?.status ?? "running");
  const error =
    tool.status === "failed"
      ? tool.rawOutput
        ? JSON.stringify(tool.rawOutput)
        : (existing?.error ?? "Antigravity tool failed")
      : existing?.error ?? null;
  const presented = presentHarnessToolExecution({
    id: executionID,
    toolName:
      tool.title?.trim() ||
      tool.kind?.trim() ||
      existing?.toolName ||
      "Antigravity tool",
    status,
    traceOrder:
      existing?.traceOrder ??
      (current.metadata?.toolExecutions?.length ?? 0) +
        (current.metadata?.reasoning?.length ?? 0),
    input: hasInput ? tool.rawInput : undefined,
    content: content ?? undefined,
    error:
      tool.rawOutput && tool.status === "failed"
        ? JSON.stringify(tool.rawOutput)
        : null,
    createdAt: existing?.createdAt ?? createdAt,
  });
  // Updates commonly omit content and input. Keep the last visible output and
  // target instead of replacing them with empty values.
  const nextExecution = { ...presented };
  if (existing) {
    const preview = nextExecution.preview ?? {
      title: nextExecution.toolName,
    };
    if (!hasInput) {
      nextExecution.inputSummary = existing.inputSummary;
      if (!tool.title?.trim())
        preview.title = existing.preview?.title ?? preview.title;
    }
    if (content === null) {
      nextExecution.outputSummary = existing.outputSummary;
      if (existing.preview?.text !== undefined) {
        preview.text = existing.preview.text;
        preview.truncated = existing.preview.truncated;
      }
      if (existing.preview?.uri) {
        preview.uri = existing.preview.uri;
        preview.mimeType = existing.preview.mimeType;
      }
      if (existing.preview?.images) preview.images = existing.preview.images;
    }
    nextExecution.preview = preview;
    nextExecution.error = error;
  }
  const nextExecutions = existing
    ? (current.metadata?.toolExecutions ?? []).map((execution) =>
        execution.id === executionID ? nextExecution : execution,
      )
    : [...(current.metadata?.toolExecutions ?? []), nextExecution];
  const nextAnchors = existing
    ? current.metadata?.toolRunAnchors ?? []
    : [
        ...(current.metadata?.toolRunAnchors ?? []),
        { executionId: executionID, textOffset: current.content.length },
      ];
  const next = replaceMessage(assistant.state, messageID, (message) => ({
    ...message,
    metadata: {
      ...message.metadata,
      toolExecutions: nextExecutions,
      toolRunAnchors: nextAnchors,
    },
    updatedAt: createdAt,
  }));
  // A tool call is part of an in-flight turn even when no text arrived first.
  return phase === "update" ? next : { ...next, running: true };
}

export function createAntigravitySessionState(input: {
  result: AcpNewSessionResult;
  cwd: string;
  messages?: StoredMessage[];
  createdAt?: string;
}): AntigravitySessionState {
  const createdAt = input.createdAt ?? nowISO();
  const modeOption = (input.result.configOptions ?? []).find(
    (option) => option.id === "mode" || option.category === "mode",
  );
  const modeValue =
    typeof modeOption?.currentValue === "string"
      ? modeOption.currentValue
      : null;
  return {
    id: input.result.sessionId,
    title: "Antigravity chat",
    cwd: input.cwd,
    modelId: input.result.models?.currentModelId ?? null,
    modeId: input.result.modes?.currentModeId ?? modeValue,
    createdAt,
    updatedAt: createdAt,
    messages: (input.messages ?? []).map((message) => ({
      ...message,
      conversationId: input.result.sessionId,
    })),
    models: input.result.models?.availableModels ?? [],
    modes: input.result.modes ?? null,
    configOptions: input.result.configOptions ?? [],
    running: false,
    currentAssistantId: null,
    currentAssistantMessageID: null,
    openReasoningID: null,
    openReasoningMessageID: null,
    stopReason: null,
  };
}

/** Start a prompt turn. Steering keeps the current assistant if one exists. */
export function beginAntigravityTurn(
  state: AntigravitySessionState,
  content: string,
  createdAt = nowISO(),
  selectedFileIds: string[] = [],
): AntigravitySessionState {
  const id = `acp:${state.id}:user:${state.messages.length}`;
  const message = newMessage(state, "user", content, id, createdAt);
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        ...message,
        metadata: selectedFileIds.length ? { selectedFileIds } : null,
      },
    ],
    running: true,
    stopReason: null,
    updatedAt: createdAt,
  };
}

export function finishAntigravityTurn(
  state: AntigravitySessionState,
  stopReason: string | null,
  failed = false,
  finishedAt = nowISO(),
): AntigravitySessionState {
  let next = closeOpenReasoning(state, finishedAt);
  if (next.currentAssistantId) {
    const id = next.currentAssistantId;
    next = replaceMessage(next, id, (message) => ({
      ...message,
      status: failed ? "failed" : "completed",
      error: failed ? (message.error ?? "Antigravity stopped this response.") : null,
      metadata: {
        ...message.metadata,
        toolExecutions: (message.metadata?.toolExecutions ?? []).map(
          (execution) =>
            execution.status === "running"
              ? {
                  ...execution,
                  status: failed ? "failed" : "completed",
                  error: failed ? (execution.error ?? "Stopped") : null,
                }
              : execution,
        ),
      },
      updatedAt: finishedAt,
    }));
  }
  return {
    ...next,
    running: false,
    stopReason,
    currentAssistantId: null,
    currentAssistantMessageID: null,
    openReasoningID: null,
    openReasoningMessageID: null,
    updatedAt: finishedAt,
  };
}

/**
 * Detach a running turn without ending it remotely. The assistant stays open
 * for further stream updates so a background response is not split into two
 * local messages.
 */
export function detachAntigravityTurn(
  state: AntigravitySessionState,
  finishedAt = nowISO(),
): AntigravitySessionState {
  const finished = finishAntigravityTurn(
    state,
    "detached",
    false,
    finishedAt,
  );
  return {
    ...finished,
    currentAssistantId: state.currentAssistantId,
    currentAssistantMessageID: state.currentAssistantMessageID,
  };
}

export function applyAntigravityUpdate(
  state: AntigravitySessionState,
  update: AcpSessionUpdate,
  at = nowISO(),
): AntigravitySessionState {
  switch (update.sessionUpdate) {
    case "session_info_update": {
      if (typeof update.title !== "string") return state;
      return {
        ...state,
        title: update.title.trim() || state.title,
        updatedAt: at,
      };
    }
    case "agent_message_chunk": {
      const text = contentText(
        Array.isArray(update.content) ? undefined : update.content,
      );
      const assistant = ensureAssistant(state, update.messageId, at);
      if (!text) return assistant.state;
      let next = assistant.state;
      if (next.openReasoningID) next = closeOpenReasoning(next, at);
      next = replaceMessage(next, assistant.messageID, (message) => ({
        ...message,
        content: message.content + text,
        status: next.running ? "streaming" : message.status,
        updatedAt: at,
      }));
      return {
        ...next,
        updatedAt: at,
      };
    }
    case "agent_thought_chunk": {
      const text = contentText(
        Array.isArray(update.content) ? undefined : update.content,
      );
      if (!text) return state;
      const assistant = ensureAssistant(state, update.messageId, at);
      let next = assistant.state;
      const current = next.messages.find(
        (message) => message.id === assistant.messageID,
      );
      if (!current) return next;
      const reasoning = current.metadata?.reasoning ?? [];
      const openIndex = next.openReasoningID
        ? reasoning.findIndex((block) => block.id === next.openReasoningID)
        : -1;
      if (openIndex >= 0) {
        const nextReasoning = reasoning.map((block, index) =>
          index === openIndex
            ? { ...block, text: block.text + text }
            : block,
        );
        next = replaceMessage(next, assistant.messageID, (message) => ({
          ...message,
          metadata: { ...message.metadata, reasoning: nextReasoning },
          updatedAt: at,
        }));
      } else {
        const id = `acp:${state.id}:reasoning:${reasoning.length}`;
        next = {
          ...next,
          openReasoningID: id,
          openReasoningMessageID: assistant.messageID,
        };
        next = replaceMessage(next, assistant.messageID, (message) => ({
          ...message,
          metadata: {
            ...message.metadata,
            reasoning: [
              ...(message.metadata?.reasoning ?? []),
              {
                id,
                text,
                textOffset: message.content.length,
                traceOrder:
                  (message.metadata?.reasoning?.length ?? 0) +
                  (message.metadata?.toolExecutions?.length ?? 0),
                startedAt: at,
                completedAt: null,
              },
            ],
          },
          updatedAt: at,
        }));
      }
      return { ...next, updatedAt: at };
    }
    case "tool_call": {
      return updateToolExecution(state, update as AcpToolCall, "call", at);
    }
    case "tool_call_update": {
      return updateToolExecution(state, update as AcpToolCall, "update", at);
    }
    case "current_mode_update": {
      const modeID =
        typeof update.currentModeId === "string"
          ? update.currentModeId
          : typeof update.modeId === "string"
            ? update.modeId
            : null;
      return modeID ? { ...state, modeId: modeID, updatedAt: at } : state;
    }
    case "config_option_update": {
      const options = Array.isArray(update.configOptions)
        ? (update.configOptions as AcpSessionConfigOption[])
        : null;
      return options
        ? { ...state, configOptions: options, updatedAt: at }
        : state;
    }
    case "usage_update": {
      return state;
    }
    default:
      return state;
  }
}

export function presentAntigravityConversation(
  state: AntigravitySessionState,
): Conversation {
  return {
    id: state.id,
    title: state.title || "Antigravity chat",
    providerId: ANTIGRAVITY_PROVIDER_ID,
    modelId: state.modelId,
    reasoningEffort: "medium",
    agentId: state.modeId,
    agentMode: state.modeId === "plan" ? "plan" : "build",
    selectedFileIds: [],
    selectedMcpServerIds: [],
    selectedSkillIds: [],
    externalFolderSession: null,
    pinnedAt: null,
    archivedAt: null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function presentAntigravityAgent(mode: AcpSessionMode): AgentConfig {
  return {
    id: mode.id,
    name: mode.name,
    description: mode.description ?? null,
    mode: "primary",
    enabled: true,
    hidden: false,
    modelProviderId: null,
    modelModelId: null,
    prompt: null,
    temperature: null,
    sourceMarkdown: null,
    toolPermissions: {},
    docs: [],
    createdAt: "",
    updatedAt: "",
  };
}

export function presentAntigravityModel(model: AcpModel): ResolvedModel {
  return {
    ref: antigravityModelRef(model.modelId),
    providerId: ANTIGRAVITY_PROVIDER_ID,
    providerFamily: "openai-compatible",
    providerAuthType: "none",
    providerLabel: "Antigravity (Harness)",
    modelId: model.modelId,
    label: model.name,
    outputType: "text",
    isDefault: false,
    isFree: false,
    source: "suggested",
    active: true,
    capabilities: {
      tools: true,
      reasoning: true,
      imageInput: true,
      audioInput: false,
      videoInput: false,
      imageGeneration: false,
    },
    supportsTools: true,
    supportsImageInput: true,
    supportsAudioInput: false,
    supportsVideoInput: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    transport: "openaiCompatible",
    options: null,
    contextWindow: null,
  };
}

/** Antigravity ships model variants, with thinking level as a separate config. */
export function antigravityModelSelection(
  model: AcpModel,
  configOptions: AcpSessionConfigOption[],
): { modelValue: string; thoughtValue: string | null } {
  const modelOption = configOptions.find(
    (option) => option.id === "model" || option.category === "model",
  );
  const thoughtOption = configOptions.find(
    (option) =>
      option.id === "thought_level" ||
      option.category === "thought_level" ||
      /thought|thinking|reason/i.test(option.id),
  );
  const values = (modelOption?.options ?? [])
    .map((option) => option.value)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const exact = values.includes(model.modelId) ? model.modelId : null;
  const base =
    exact ??
    values.find((value) => model.modelId.startsWith(`${value}-`)) ??
    null;
  let thought: string | null = base
    ? model.modelId.slice(base.length).replace(/^-/, "") || null
    : null;
  const suffix = model.modelId.match(/-(low|medium|high|xhigh|max)$/i);
  if (!thought && suffix) thought = suffix[1].toLowerCase();
  if (thought) {
    const allowed = new Set(
      (thoughtOption?.options ?? []).map((option) => option.value),
    );
    if (allowed.size && !allowed.has(thought)) thought = null;
  }
  return {
    modelValue: base ?? model.modelId,
    thoughtValue: thought,
  };
}

export function antigravityModels(
  result: Pick<AcpNewSessionResult, "models" | "configOptions">,
): AcpModel[] {
  if (result.models?.availableModels?.length)
    return result.models.availableModels;
  const modelOption = (result.configOptions ?? []).find(
    (option) => option.id === "model" || option.category === "model",
  );
  return (modelOption?.options ?? []).map((option) => ({
    modelId: option.value,
    name: option.name,
  }));
}

export function antigravityModeForState(
  state: AntigravitySessionState,
): AcpSessionModeState | null {
  if (state.modes) return state.modes;
  const option = state.configOptions.find(
    (entry) => entry.id === "mode" || entry.category === "mode",
  );
  if (!option?.options?.length) return null;
  return {
    currentModeId: String(option.currentValue),
    availableModes: option.options.map((value) => ({
      id: value.value,
      name: value.name,
      description: value.description ?? null,
    })),
  };
}

export type PendingAntigravityPermission = {
  id: string;
  requestID: string | number;
  sessionID: string;
  options: AcpPermissionOption[];
  approval: PendingToolApproval;
};

export function presentAntigravityPermission(
  request: AcpPermissionRequest & { id?: string | number },
  chatTitle: string,
): PendingAntigravityPermission {
  const requestID = request.id ?? request.toolCall.toolCallId;
  const title =
    request.toolCall.title?.trim() ||
    request.toolCall.kind?.trim() ||
    "Antigravity tool";
  return {
    id: String(requestID),
    requestID,
    sessionID: request.sessionId,
    options: request.options ?? [],
    approval: {
      id: String(requestID),
      toolName: title,
      inputSummary: request.toolCall.rawInput
        ? JSON.stringify(request.toolCall.rawInput, null, 2)
        : title,
      chatTitle,
      conversationId: request.sessionId,
      runId: request.sessionId,
    },
  };
}

/** Choose the ACP permission option that best matches the app's decision. */
export function antigravityPermissionOption(
  options: AcpPermissionOption[],
  decision: "once" | "always" | "reject",
): AcpPermissionOption | null {
  const find = (kinds: string[]) =>
    options.find((option) => kinds.includes(option.kind)) ?? null;
  if (decision === "reject")
    return (
      find(["reject_once", "reject_always"]) ??
      options.find((option) => /reject|deny|cancel|no/i.test(option.kind)) ??
      null
    );
  if (decision === "always")
    return (
      find(["allow_always"]) ??
      find(["allow_once"]) ??
      options.find((option) => /allow|approve|yes/i.test(option.kind)) ??
      null
    );
  return (
    find(["allow_once"]) ??
    find(["allow_always"]) ??
    options.find((option) => /allow|approve|yes/i.test(option.kind)) ??
    null
  );
}

/**
 * Local rows that the remote session has not seen yet. Build one hidden text
 * block so the model can continue from a chat that was last used with a direct
 * provider.
 */
export function buildAntigravityContext(
  messages: StoredMessage[],
  syncedMessageIDs: string[],
): { text: string | null; ids: string[] } {
  const synced = new Set(syncedMessageIDs);
  const pending = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      message.content.trim() &&
      message.status !== "streaming" &&
      !synced.has(message.id),
  );
  const lines = pending.map(
    (message) =>
      `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}`,
  );
  if (!lines.length) return { text: null, ids: [] };
  const maxLength = 20_000;
  let transcript = lines.join("\n\n");
  if (transcript.length > maxLength) {
    transcript = `[Earlier detached messages omitted.]\n\n${transcript.slice(-maxLength)}`;
  }
  return {
    text: [
      "While the Antigravity harness was detached, the user continued this chat with another provider.",
      "Treat the exchange below as prior context. Do not repeat it or answer it directly; continue the conversation from it.",
      "",
      transcript,
    ].join("\n"),
    ids: pending.map((message) => message.id),
  };
}
