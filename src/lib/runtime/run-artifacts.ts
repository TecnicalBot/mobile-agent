import * as Crypto from "expo-crypto";
import type { ModelMessage } from "ai";

import type {
  AgentRun,
  ExecutionTimelineEvent,
  PromptArtifact,
  ResolvedModel,
  ToolExecutionRecord,
} from "@/types/app-state";

function formatTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function serializeMessageContent(content: ModelMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function createExecutionTimelineEvent(input: {
  createdAt?: string;
  detail?: string | null;
  kind: ExecutionTimelineEvent["kind"];
  status: ExecutionTimelineEvent["status"];
  title: string;
}): ExecutionTimelineEvent {
  return {
    id: Crypto.randomUUID(),
    kind: input.kind,
    status: input.status,
    title: input.title,
    detail: input.detail ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createPromptArtifactRecord(input: {
  category: PromptArtifact["category"];
  createdAt?: string;
  displayName: string;
  fileId: string;
  relativePath: string;
}): PromptArtifact {
  return {
    id: Crypto.randomUUID(),
    category: input.category,
    createdAt: input.createdAt ?? new Date().toISOString(),
    displayName: input.displayName,
    fileId: input.fileId,
    relativePath: input.relativePath,
  };
}

export function buildModelPromptArtifact(input: {
  messages: ModelMessage[];
  model: ResolvedModel;
  run: AgentRun;
  system?: string;
}) {
  const timestamp = formatTimestamp(new Date().toISOString());
  const fileName = `${timestamp}-${input.model.providerId}-${input.model.modelId}.txt`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  const sections = [
    `Run ID: ${input.run.id}`,
    `Conversation ID: ${input.run.conversationId}`,
    `Provider: ${input.model.providerLabel} (${input.model.providerId})`,
    `Model: ${input.model.label} (${input.model.modelId})`,
    `Started: ${input.run.startedAt}`,
    `File context source: ${input.run.fileContextSource ?? "workspace"}`,
    `Supports tools: ${input.model.supportsTools ? "yes" : "no"}`,
    `Supports image input: ${input.model.supportsImageInput ? "yes" : "no"}`,
    `Supports image generation: ${
      input.model.supportsImageGeneration ? "yes" : "no"
    }`,
    "",
    "System prompt:",
    input.system?.trim() || "(none)",
    "",
    "Messages:",
    ...input.messages.map((message, index) =>
      [
        `#${index + 1} ${message.role}`,
        serializeMessageContent(message.content),
      ].join("\n"),
    ),
  ];

  return {
    content: sections.join("\n\n"),
    fileName,
  };
}

export function buildToolContextArtifact(input: {
  run: AgentRun;
  system?: string;
  toolNames: string[];
}) {
  const timestamp = formatTimestamp(new Date().toISOString());
  const fileName = `${timestamp}-${input.run.id}-tool-context.txt`;

  return {
    content: [
      `Run ID: ${input.run.id}`,
      `Conversation ID: ${input.run.conversationId}`,
      `Started: ${input.run.startedAt}`,
      "",
      `Available tools: ${input.toolNames.join(", ") || "(none)"}`,
      "",
      "Tool runtime prompt:",
      input.system?.trim() || "(none)",
    ].join("\n"),
    fileName,
  };
}

export function buildToolExecutionArtifact(input: {
  record: ToolExecutionRecord;
  runId: string;
}) {
  const timestamp = formatTimestamp(input.record.createdAt);
  const fileName =
    `${timestamp}-${input.runId}-${input.record.toolName}-${input.record.status}.txt`
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");

  return {
    content: [
      `Run ID: ${input.runId}`,
      `Created: ${input.record.createdAt}`,
      `Tool: ${input.record.toolName}`,
      `Status: ${input.record.status}`,
      "",
      "Input summary:",
      input.record.inputSummary,
      "",
      "Output summary:",
      input.record.outputSummary?.trim() || "(none)",
      "",
      "Error:",
      input.record.error?.trim() || "(none)",
    ].join("\n"),
    fileName,
  };
}
