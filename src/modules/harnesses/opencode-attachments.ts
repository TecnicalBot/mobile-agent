import type { WorkspaceFile } from "@/core/types/app-state";

/** OpenCode rejects attachments above 20 MiB; keep a little headroom for the data URL. */
export const MAX_OPENCODE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Match the direct runtime's request cap so one prompt cannot carry an unbounded payload. */
export const MAX_OPENCODE_ATTACHMENTS = 20;

export type OpenCodePromptFile = {
  uri: string;
  name?: string;
};

export type ResolvedAttachmentFile = {
  exists: boolean;
  size?: number | null;
  bytes: () => Promise<Uint8Array>;
};

export type OpenCodeAttachmentResult = {
  files: OpenCodePromptFile[];
  skipped: string[];
};

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

/**
 * OpenCode reads `data:` attachments itself, so a phone file does not need to
 * exist on the harness host. Text, image, audio, and video files all travel as
 * one self-contained data URL.
 */
export async function buildOpenCodePromptFiles(input: {
  files: WorkspaceFile[];
  resolveFile: (relativePath: string) => ResolvedAttachmentFile;
  signal?: AbortSignal;
}): Promise<OpenCodeAttachmentResult> {
  const result: OpenCodeAttachmentResult = { files: [], skipped: [] };
  let budget = MAX_OPENCODE_ATTACHMENT_BYTES;

  for (const file of input.files) {
    if (result.files.length >= MAX_OPENCODE_ATTACHMENTS) {
      result.skipped.push(file.displayName);
      continue;
    }
    if (input.signal?.aborted) throw new Error("Cancelled");

    const local = input.resolveFile(file.relativePath);
    if (!local.exists) {
      result.skipped.push(file.displayName);
      continue;
    }

    const size = Math.max(file.size ?? 0, local.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > budget) {
      result.skipped.push(file.displayName);
      continue;
    }

    const bytes = await local.bytes();
    if (bytes.byteLength > budget) {
      result.skipped.push(file.displayName);
      continue;
    }

    budget -= bytes.byteLength;
    result.files.push({
      uri: `data:${file.mimeType ?? "application/octet-stream"};base64,${bytesToBase64(bytes)}`,
      name: file.displayName,
    });
  }

  return result;
}
