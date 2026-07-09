import type { ModelMessage } from "ai";

import { resolveWorkspaceFile } from "@/lib/workspace/workspace-file-service";
import type { MessageRole, StoredMessage, WorkspaceFile } from "@/types/app-state";

const IMAGE_MIME_PREFIXES = ["image/"];
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-typescript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-yaml",
]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".xml",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".sh",
  ".env",
  ".csv",
  ".log",
]);

export function isImageMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }

  const lower = mimeType.trim().toLowerCase();
  return IMAGE_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function isTextFile(file: Pick<WorkspaceFile, "displayName" | "mimeType">) {
  const mimeType = file.mimeType?.toLowerCase() ?? "";

  if (
    TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(mimeType)
  ) {
    return true;
  }

  const lowerName = file.displayName.toLowerCase();

  for (const extension of TEXT_EXTENSIONS) {
    if (lowerName.endsWith(extension)) {
      return true;
    }
  }

  return false;
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

async function buildWorkspaceImageParts(files: WorkspaceFile[]) {
  return Promise.all(
    files.map(async (file) => {
      const localFile = resolveWorkspaceFile(file.relativePath);

      if (!localFile.exists) {
        throw new Error(`${file.displayName} is no longer available locally.`);
      }

      return {
        type: "file" as const,
        filename: file.displayName,
        mediaType: file.mimeType ?? "image/png",
        data: {
          type: "data" as const,
          data: await localFile.bytes(),
        },
      };
    }),
  );
}

function parseStoredContent(
  message: StoredMessage,
): string | Array<Record<string, unknown>> {
  if (message.content.startsWith("[")) {
    try {
      const parsed = JSON.parse(message.content);

      if (Array.isArray(parsed)) {
        return parsed as Array<Record<string, unknown>>;
      }
    } catch {}
  }

  return message.content;
}

export async function convertStoredMessagesToModelMessages(input: {
  messages: StoredMessage[];
  supportsImageInput: boolean;
  workspaceFilesById: Map<string, WorkspaceFile>;
}) {
  const converted: ModelMessage[] = [];
  const unsupportedImageAttachments: WorkspaceFile[] = [];

  for (const message of input.messages.filter(
    (item): item is StoredMessage & { role: MessageRole } =>
      item.role === "assistant" ||
      item.role === "system" ||
      item.role === "user",
  )) {
    const parsedContent = parseStoredContent(message);

    if (message.role !== "user") {
      converted.push({
        role: message.role,
        content: parsedContent,
      } as ModelMessage);
      continue;
    }

    const selectedFiles = (message.metadata?.selectedFileIds ?? [])
      .map((fileId) => input.workspaceFilesById.get(fileId))
      .filter((file): file is WorkspaceFile => file !== undefined);
    const { imageFiles } = partitionSelectedFiles(selectedFiles);

    if (imageFiles.length === 0) {
      converted.push({
        role: message.role,
        content: parsedContent,
      } as ModelMessage);
      continue;
    }

    const parts: Array<Record<string, unknown>> = [];

    if (typeof parsedContent === "string" && parsedContent.trim()) {
      parts.push({
        type: "text",
        text: parsedContent,
      });
    } else if (Array.isArray(parsedContent)) {
      parts.push(...parsedContent);
    }

    if (input.supportsImageInput) {
      parts.push(...(await buildWorkspaceImageParts(imageFiles)));
    } else {
      unsupportedImageAttachments.push(...imageFiles);
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
    unsupportedImageAttachments,
  };
}
