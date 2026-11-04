import type { ModelMessage } from "ai";

import {
  isDocumentWorkspaceFile,
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type { MessageRole, StoredMessage, WorkspaceFile } from "@/core/types/app-state";
import { mediaEvidenceForMessage } from "@/modules/runtime/conversation-evidence";
import { applyStoredCompaction } from "@/modules/context/stored-compaction";

const IMAGE_MIME_PREFIXES = ["image/"];
const AUDIO_MIME_PREFIXES = ["audio/"];
const VIDEO_MIME_PREFIXES = ["video/"];

function mimeStartsWith(
  mimeType: string | null | undefined,
  prefixes: string[],
) {
  if (!mimeType) {
    return false;
  }

  const lower = mimeType.trim().toLowerCase();
  return prefixes.some((prefix) => lower.startsWith(prefix));
}

export function isImageMimeType(mimeType: string | null | undefined): boolean {
  return mimeStartsWith(mimeType, IMAGE_MIME_PREFIXES);
}

export function isAudioMimeType(mimeType: string | null | undefined): boolean {
  return mimeStartsWith(mimeType, AUDIO_MIME_PREFIXES);
}

export function isVideoMimeType(mimeType: string | null | undefined): boolean {
  return mimeStartsWith(mimeType, VIDEO_MIME_PREFIXES);
}

function isTextFile(file: Pick<WorkspaceFile, "displayName" | "mimeType">) {
  return isTextWorkspaceFile(file) || isDocumentWorkspaceFile(file);
}

export type PartitionedFiles = {
  binaryFiles: WorkspaceFile[];
  imageFiles: WorkspaceFile[];
  textFiles: WorkspaceFile[];
};

export function partitionSelectedFiles(files: WorkspaceFile[]): PartitionedFiles {
  const textFiles: WorkspaceFile[] = [];
  const imageFiles: WorkspaceFile[] = [];
  const binaryFiles: WorkspaceFile[] = [];

  for (const file of files) {
    if (isTextFile(file)) {
      textFiles.push(file);
    } else if (isImageMimeType(file.mimeType)) {
      imageFiles.push(file);
    } else {
      binaryFiles.push(file);
    }
  }

  return { textFiles, imageFiles, binaryFiles };
}

async function buildWorkspaceMediaParts(
  files: WorkspaceFile[],
  budget: { bytes: number; parts: number },
  deferred: WorkspaceFile[],
  fallbackMediaType = "application/octet-stream",
) {
  const parts = [];
  // Serialize reads, and bound retained bytes across the entire conversation.
  // Parallel reads of hundreds of originals can kill Android before fetch starts.
  for (const file of files) {
    const localFile = resolveWorkspaceFile(file.relativePath);

    if (!localFile.exists) {
      throw new Error(`${file.displayName} is no longer available locally.`);
    }

    const size = Math.max(file.size ?? 0, localFile.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > budget.bytes || budget.parts <= 0) {
      deferred.push(file);
      continue;
    }
    budget.bytes -= size;
    budget.parts -= 1;
    parts.push({
      type: "file" as const,
      filename: file.displayName,
      mediaType: file.mimeType ?? fallbackMediaType,
      data: {
        type: "data" as const,
        data: await localFile.bytes(),
      },
    });
  }
  return parts;
}

/**
 * Direct model input is capped: huge audio/video payloads blow up request
 * size and context. Larger files stay usable through the transcribeAudio,
 * analyzeAudio, and getVideoFrame tools instead.
 */
export const MAX_DIRECT_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_REQUEST_MEDIA_PARTS = 20;

function parseStoredContent(
  message: StoredMessage,
): string | Record<string, unknown>[] {
  if (message.content.startsWith("[")) {
    try {
      const parsed = JSON.parse(message.content);

      if (Array.isArray(parsed)) {
        return parsed as Record<string, unknown>[];
      }
    } catch {}
  }

  return message.content;
}

function buildAssistantContent(
  message: StoredMessage,
  parsedContent: string | Record<string, unknown>[],
  evidence: string,
) {
  const reasoningParts = (message.metadata?.reasoning ?? [])
    .filter((block) => block.text.trim())
    .map((block) => ({
      type: "reasoning",
      text: block.text,
    }));

  if (reasoningParts.length === 0 && !evidence) {
    return parsedContent;
  }

  const content: Record<string, unknown>[] = [...reasoningParts];

  if (typeof parsedContent === "string") {
    if (parsedContent.trim()) {
      content.push({
        type: "text",
        text: parsedContent,
      });
    }
  } else {
    content.push(...parsedContent);
  }
  if (evidence) content.push({ type: "text", text: evidence });

  return content;
}

export async function convertStoredMessagesToModelMessages(input: {
  messages: StoredMessage[];
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  workspaceFilesById: Map<string, WorkspaceFile>;
}) {
  const converted: ModelMessage[] = [];
  const unsupportedAttachments: WorkspaceFile[] = [];
  const memoryLimitedAttachments: WorkspaceFile[] = [];
  // Raw bytes are also copied/base64-encoded by providers. A per-file limit
  // alone does not protect the mobile heap when history contains many files.
  const budget = { bytes: MAX_DIRECT_MEDIA_BYTES, parts: MAX_REQUEST_MEDIA_PARTS };

  for (const message of applyStoredCompaction(input.messages).filter(
    (item): item is StoredMessage & { role: MessageRole } =>
      item.role === "assistant" ||
      item.role === "system" ||
      item.role === "user",
  )) {
    const parsedContent = parseStoredContent(message);

    if (message.role === "assistant") {
      converted.push({
        role: message.role,
        content: buildAssistantContent(message, parsedContent, mediaEvidenceForMessage(message, input.workspaceFilesById)),
      } as ModelMessage);
      continue;
    }

    if (message.role === "system") {
      converted.push({
        role: message.role,
        content: parsedContent,
      } as ModelMessage);
      continue;
    }

    const selectedFiles = (message.metadata?.selectedFileIds ?? [])
      .map((fileId) => input.workspaceFilesById.get(fileId))
      .filter((file): file is WorkspaceFile => file !== undefined);
    const { binaryFiles, imageFiles } = partitionSelectedFiles(selectedFiles);
    const audioFiles = binaryFiles.filter((file) =>
      isAudioMimeType(file.mimeType),
    );
    const videoFiles = binaryFiles.filter((file) =>
      isVideoMimeType(file.mimeType),
    );

    if (
      imageFiles.length === 0 &&
      audioFiles.length === 0 &&
      videoFiles.length === 0
    ) {
      converted.push({
        role: message.role,
        content: parsedContent,
      } as ModelMessage);
      continue;
    }

    const parts: Record<string, unknown>[] = [];
    const deferred: WorkspaceFile[] = [];

    if (typeof parsedContent === "string" && parsedContent.trim()) {
      parts.push({
        type: "text",
        text: parsedContent,
      });
    } else if (Array.isArray(parsedContent)) {
      parts.push(...parsedContent);
    }

    if (input.supportsImageInput) {
      parts.push(
        ...(await buildWorkspaceMediaParts(imageFiles, budget, deferred, "image/png")),
      );
    } else {
      unsupportedAttachments.push(...imageFiles);
    }

    const sendable = (files: WorkspaceFile[]) =>
      files.filter((file) => (file.size ?? 0) <= MAX_DIRECT_MEDIA_BYTES);
    const oversized = (files: WorkspaceFile[]) =>
      files.filter((file) => (file.size ?? 0) > MAX_DIRECT_MEDIA_BYTES);

    if (input.supportsAudioInput) {
      parts.push(...(await buildWorkspaceMediaParts(sendable(audioFiles), budget, deferred)));
      unsupportedAttachments.push(...oversized(audioFiles));
    } else {
      unsupportedAttachments.push(...audioFiles);
    }

    if (input.supportsVideoInput) {
      parts.push(...(await buildWorkspaceMediaParts(sendable(videoFiles), budget, deferred)));
      unsupportedAttachments.push(...oversized(videoFiles));
    } else {
      unsupportedAttachments.push(...videoFiles);
    }

    if (deferred.length > 0) {
      unsupportedAttachments.push(...deferred);
      memoryLimitedAttachments.push(...deferred);
      parts.push({
        type: "text",
        text: `${deferred.length} attachment(s) were not included as direct media because of the mobile memory limit. Direct-media omission does not mean they have never been inspected: reuse prior conversation evidence and saved results, and inspect only missing information relevant to the current request.`,
      });
    }

    converted.push({
      role: message.role,
      content:
        parts.length === 1 &&
        parts[0]?.type === "text" &&
        typeof parts[0].text === "string"
          ? parts[0].text
          : parts,
    } as ModelMessage);
  }

  return {
    messages: converted,
    unsupportedAttachments,
    memoryLimitedAttachments,
  };
}
