import type {
  AgentInfo,
  FormInfo,
  ModelInfo,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client";
import type {
  AgentConfig,
  Conversation,
  ModelRef,
  ResolvedModel,
  StoredMessage,
  ToolExecutionRecord,
  GeneratedVideoAttachment,
  PendingQuestionnaire,
  PendingQuestionnaireAnswer,
} from "@/core/types/app-state";
import {
  openCodeErrorMessage,
  openCodeLastConversationMessage,
} from "@/modules/harnesses/opencode-recovery";
import { presentHarnessToolExecution } from "@/modules/harnesses/tool-execution";

export const OPENCODE_PROVIDER_ID = "harness:opencode";

/** UI metadata only; OpenCode still owns prompts, tools, and permissions. */
export function presentOpenCodeAgent(agent: AgentInfo): AgentConfig {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? null,
    mode: agent.mode,
    enabled: true,
    hidden: agent.hidden,
    modelProviderId: agent.model?.providerID ?? null,
    modelModelId: agent.model?.id ?? null,
    prompt: null,
    temperature: null,
    sourceMarkdown: null,
    toolPermissions: {},
    docs: [],
    createdAt: "",
    updatedAt: "",
  };
}
export const openCodeModelRef = (
  model: Pick<ModelInfo, "id" | "providerID">,
): ModelRef =>
  `harness:opencode/${encodeURIComponent(model.providerID)}/${encodeURIComponent(model.id)}`;

/** Presentation only. Harness refs are intercepted before the direct model runtime. */
export function presentOpenCodeModel(model: ModelInfo): ResolvedModel {
  // Older harnesses did not report capabilities. Treat the model as text-only
  // instead of enabling attachment UI the harness cannot consume.
  const capabilities = model.capabilities ?? {
    tools: false,
    input: [] as string[],
    output: [] as string[],
  };
  const inputs = new Set(capabilities.input);
  const supportsInput = (kind: string) =>
    inputs.has(kind) ||
    [...inputs].some((value) => value.startsWith(`${kind}/`));
  const supportsTools = capabilities.tools;
  const supportsImageInput = supportsInput("image");
  const supportsAudioInput = supportsInput("audio");
  const supportsVideoInput = supportsInput("video");
  return {
    ref: openCodeModelRef(model),
    providerId: OPENCODE_PROVIDER_ID,
    providerFamily: "openai-compatible",
    providerAuthType: "none",
    providerLabel: "OpenCode (Harness)",
    modelId: model.id,
    label: model.name,
    outputType: "text",
    isDefault: false,
    isFree: model.cost.every((cost) => cost.input === 0 && cost.output === 0),
    source: "suggested",
    active: model.enabled,
    capabilities: {
      tools: supportsTools,
      reasoning: false,
      imageInput: supportsImageInput,
      audioInput: supportsAudioInput,
      videoInput: supportsVideoInput,
      imageGeneration: false,
    },
    supportsTools,
    supportsImageInput,
    supportsAudioInput,
    supportsVideoInput,
    supportsImageGeneration: false,
    supportsReasoning: false,
    transport: "openaiCompatible",
    options: null,
    contextWindow: model.limit.context,
  };
}

export function presentOpenCodeConversation(
  session: SessionInfo,
): Conversation {
  return {
    id: session.id,
    title: session.title || "OpenCode chat",
    providerId: OPENCODE_PROVIDER_ID,
    modelId: session.model?.id ?? null,
    reasoningEffort: "medium",
    agentId: session.agent ?? null,
    agentMode: session.agent === "plan" ? "plan" : "build",
    selectedFileIds: [],
    selectedMcpServerIds: [],
    selectedSkillIds: [],
    externalFolderSession: null,
    parentConversationId: null,
    rootConversationId: null,
    relationshipToParent: null,
    pinnedAt: null,
    archivedAt: null,
    createdAt: new Date(session.time.created).toISOString(),
    updatedAt: new Date(session.time.updated).toISOString(),
  };
}

/** Stable local ID for a remote message, including rows the chat UI omits. */
export function openCodeStoredMessageID(message: SessionMessageInfo): string {
  return typeof message.metadata?.mobileAgentMessageId === "string"
    ? message.metadata.mobileAgentMessageId
    : message.id;
}

export function presentOpenCodeMessages(
  messages: SessionMessageInfo[],
  sessionID: string,
  running: boolean,
  conversationId = sessionID,
  includeSystem = false,
): StoredMessage[] {
  // OpenCode emits one assistant message per step. A step can be marked
  // completed while the session is still running and the next step has not
  // arrived yet. Treat the latest assistant as streaming for the whole turn so
  // the UI keeps its loader and does not show the "finished" footer in that gap.
  const lastAssistantID = [...messages]
    .reverse()
    .find((message) => message.type === "assistant")?.id;
  // A new prompt can land before the server creates its assistant step. Until
  // that step arrives the previous assistant is still the last one, but it is
  // not streaming anymore: marking it would put the "Thinking" row above the
  // prompt the user just sent.
  const lastConversationMessage = openCodeLastConversationMessage(messages);
  const waitingForAssistant = lastConversationMessage?.type === "user";

  const presented = messages.flatMap((message, sequence): StoredMessage[] => {
    if (message.type === "system") {
      if (!includeSystem) return [];
      const createdAt = new Date(message.time.created).toISOString();
      return [
        {
          id: openCodeStoredMessageID(message),
          conversationId,
          role: "system",
          content: message.text,
          metadata: null,
          status: "completed",
          error: null,
          sequence,
          createdAt,
          updatedAt: createdAt,
        },
      ];
    }
    if (message.type !== "user" && message.type !== "assistant") return [];
    const createdAt = new Date(message.time.created).toISOString();
    // Imported transcripts keep a pointer to the local message so switching
    // back and forth does not duplicate rows or break message references.
    const storedMessageID = openCodeStoredMessageID(message);
    let content = "";
    const tools: ToolExecutionRecord[] = [];
    const generatedVideos: GeneratedVideoAttachment[] = [];
    const toolRunAnchors: { executionId: string; textOffset: number }[] = [];
    const reasoning: NonNullable<
      NonNullable<StoredMessage["metadata"]>["reasoning"]
    > = [];
    if (message.type === "user") content = message.text;
    else
      message.content.forEach((part, index) => {
        if (part.type === "text") content += part.text;
        else if (part.type === "reasoning")
          reasoning.push({
            id: `${storedMessageID}:reasoning:${index}`,
            text: part.text,
            textOffset: content.length,
            traceOrder: index,
            startedAt: createdAt,
            completedAt: part.time?.completed
              ? new Date(part.time.completed).toISOString()
              : null,
          });
        else {
          const state = part.state;
          toolRunAnchors.push({
            executionId: part.id,
            textOffset: content.length,
          });
          // Only phone render results refer to this device's workspace. Host
          // paths and arbitrary remote attachments must not become local files.
          if (
            state.status === "completed" &&
            /^mobile_agent_phone_+renderVideo$/.test(part.name) &&
            "content" in state
          ) {
            for (const item of state.content ?? []) {
              if (item.type !== "text") continue;
              try {
                const output: unknown = JSON.parse(item.text);
                if (!output || typeof output !== "object") continue;
                const video = output as Record<string, unknown>;
                if (
                  typeof video.fileId !== "string" ||
                  !video.fileId ||
                  video.link !== `workspace://${video.fileId}` ||
                  video.mimeType !== "video/mp4" ||
                  typeof video.displayName !== "string" ||
                  typeof video.size !== "number" ||
                  !Number.isFinite(video.size) ||
                  video.size < 0
                )
                  continue;
                if (
                  !generatedVideos.some(
                    (entry) => entry.fileId === video.fileId,
                  )
                )
                  generatedVideos.push({
                    fileId: video.fileId,
                    displayName: video.displayName,
                    mimeType: video.mimeType,
                    size: video.size,
                    uri: `workspace://${video.fileId}`,
                  });
              } catch {
                // Ordinary text/error results are not attachments.
              }
            }
          }
          tools.push(
            presentHarnessToolExecution({
              id: part.id,
              toolName: part.name,
              traceOrder: index,
              status:
                state.status === "error"
                  ? "failed"
                  : state.status === "completed"
                    ? "completed"
                    : "running",
              input: "input" in state ? state.input : undefined,
              content: "content" in state ? state.content : undefined,
              error: "error" in state ? JSON.stringify(state.error) : null,
              createdAt,
            }),
          );
        }
      });
    return [
      {
        id: storedMessageID,
        conversationId: conversationId,
        role: message.type === "user" ? "user" : "assistant",
        content,
        metadata: {
          agentName: "OpenCode",
          toolExecutions: tools,
          reasoning,
          toolRunAnchors,
          generatedVideos,
        },
        status:
          message.type === "assistant" && message.error
            ? "failed"
            : message.type === "assistant" &&
                running &&
                !waitingForAssistant &&
                message.id === lastAssistantID
              ? "streaming"
              : "completed",
        error:
          message.type === "assistant" && message.error
            ? openCodeErrorMessage(message.error)
            : null,
        sequence,
        createdAt,
        updatedAt: createdAt,
      },
    ];
  });

  if (!running || !waitingForAssistant) {
    return presented;
  }

  // Keep the loader attached to the turn the user just submitted. The row is
  // presentation-only: the real assistant step replaces it as soon as the
  // harness reports one.
  const createdAt = new Date(
    lastConversationMessage.time.created + 1,
  ).toISOString();

  presented.push({
    id: `opencode-pending-assistant:${sessionID}:${lastConversationMessage.id}`,
    conversationId,
    role: "assistant",
    content: "",
    metadata: {
      agentName: "OpenCode",
      reasoning: [],
      toolExecutions: [],
      toolRunAnchors: [],
    },
    status: "streaming",
    error: null,
    sequence: messages.length,
    createdAt,
    updatedAt: createdAt,
  });

  return presented;
}

export function presentOpenCodeQuestionnaire(
  form: FormInfo,
  title: string,
): PendingQuestionnaire {
  return {
    id: form.id,
    conversationId: form.sessionID,
    runId: form.sessionID,
    chatTitle: title,
    items: form.fields
      .filter((field) => !("hidden" in field && field.hidden))
      .map((field) => ({
        id: field.key,
        prompt: field.title || field.key,
        description:
          field.type === "external"
            ? `Complete authorization in OpenCode: ${field.url}`
            : field.description,
        required: "required" in field ? field.required : false,
        multiple: field.type === "multiselect",
        choices:
          field.type === "boolean"
            ? ["Yes", "No"]
            : "options" in field
              ? field.options?.map((option) => option.label)
              : undefined,
        allowFreeform:
          field.type !== "boolean" &&
          field.type !== "external" &&
          (!("options" in field) ||
            !field.options?.length ||
            Boolean(field.custom)),
      })),
  };
}

export function openCodeFormAnswer(
  form: FormInfo,
  answers: PendingQuestionnaireAnswer[],
) {
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const field of form.fields) {
    if (field.type === "external" || field.hidden) continue;
    const value =
      answers.find((answer) => answer.id === field.key)?.value ?? field.default;
    if (value === null || value === undefined || value === "") {
      if (field.required)
        throw new Error(`${field.title || field.key} is required.`);
      continue;
    }
    if (field.type === "boolean")
      result[field.key] = value === "Yes" || value === true;
    else if (field.type === "number" || field.type === "integer") {
      const number = Number(value);
      if (
        !Number.isFinite(number) ||
        (field.type === "integer" && !Number.isInteger(number))
      )
        throw new Error("Enter a valid number.");
      result[field.key] = number;
    } else if (field.type === "multiselect") {
      result[field.key] = (Array.isArray(value) ? value : [String(value)]).map(
        (entry) =>
          field.options.find((option) => option.label === entry)?.value ??
          entry,
      );
    } else
      result[field.key] =
        field.options?.find((option) => option.label === value)?.value ??
        String(value);
  }
  return result;
}
