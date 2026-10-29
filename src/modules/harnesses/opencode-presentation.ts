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
  PendingQuestionnaire,
  PendingQuestionnaireAnswer,
} from "@/core/types/app-state";

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
    // Phone attachments/tools are not exposed to the remote harness.
    capabilities: {
      tools: false,
      reasoning: false,
      imageInput: false,
      audioInput: false,
      videoInput: false,
      imageGeneration: false,
    },
    supportsTools: false,
    supportsImageInput: false,
    supportsAudioInput: false,
    supportsVideoInput: false,
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
    pinnedAt: null,
    archivedAt: null,
    createdAt: new Date(session.time.created).toISOString(),
    updatedAt: new Date(session.time.updated).toISOString(),
  };
}

export function presentOpenCodeMessages(
  messages: SessionMessageInfo[],
  sessionID: string,
  running: boolean,
): StoredMessage[] {
  return messages.flatMap((message, sequence): StoredMessage[] => {
    if (message.type !== "user" && message.type !== "assistant") return [];
    const createdAt = new Date(message.time.created).toISOString();
    let content = "";
    const tools: ToolExecutionRecord[] = [];
    const reasoning: NonNullable<
      NonNullable<StoredMessage["metadata"]>["reasoning"]
    > = [];
    if (message.type === "user") content = message.text;
    else
      message.content.forEach((part, index) => {
        if (part.type === "text") content += part.text;
        else if (part.type === "reasoning")
          reasoning.push({
            id: `${message.id}:reasoning:${index}`,
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
          tools.push({
            id: part.id,
            toolName: part.name,
            traceOrder: index,
            status:
              state.status === "error"
                ? "failed"
                : state.status === "completed"
                  ? "completed"
                  : "running",
            inputSummary: "input" in state ? JSON.stringify(state.input) : "",
            outputSummary:
              "content" in state
                ? (state.content
                    ?.map((item) =>
                      item.type === "text" ? item.text : "[Remote file]",
                    )
                    .join("\n") ?? null)
                : null,
            error: "error" in state ? JSON.stringify(state.error) : null,
            createdAt,
          });
        }
      });
    return [
      {
        id: message.id,
        conversationId: sessionID,
        role: message.type === "user" ? "user" : "assistant",
        content,
        metadata: { agentName: "OpenCode", toolExecutions: tools, reasoning },
        status:
          message.type === "assistant" && message.error
            ? "failed"
            : message.type === "assistant" && running && !message.time.completed
              ? "streaming"
              : "completed",
        error:
          message.type === "assistant" && message.error
            ? JSON.stringify(message.error)
            : null,
        sequence,
        createdAt,
        updatedAt: createdAt,
      },
    ];
  });
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
