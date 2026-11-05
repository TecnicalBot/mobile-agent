import type { WorkspaceFile } from "@/core/types/app-state";

/** OpenCode rejects one attachment above 20 MiB; the inline budget matches its desktop client. */
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
  /** Native file handles can stream large uploads without loading them into the JS heap. */
  upload?: (
    url: string,
    options?: {
      httpMethod?: "POST" | "PUT" | "PATCH";
      uploadType?: 0 | 1;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ) => Promise<{ status: number; body: string }>;
};

export type OpenCodeAttachmentUpload = {
  file: WorkspaceFile;
  size: number;
  /** Set when the file was small enough that reading it could not exhaust the heap. */
  bytes?: Uint8Array;
  /** Native streaming handle, preferred over `bytes` for large files. */
  source?: ResolvedAttachmentFile;
};

export type OpenCodeAttachmentResult = {
  files: OpenCodePromptFile[];
  /** Files too large to inline. The caller uploads them to the harness host instead. */
  uploads: OpenCodeAttachmentUpload[];
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
  const result: OpenCodeAttachmentResult = {
    files: [],
    uploads: [],
    skipped: [],
  };
  let budget = MAX_OPENCODE_ATTACHMENT_BYTES;

  for (const file of input.files) {
    if (
      result.files.length + result.uploads.length >=
      MAX_OPENCODE_ATTACHMENTS
    ) {
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
    if (!Number.isFinite(size) || size <= 0) {
      result.skipped.push(file.displayName);
      continue;
    }

    // A native handle can stream oversized files without reading them into the
    // JS heap. Without one (including tests and older resolvers), fall back to
    // reading the bytes for the upload.
    const declaredTooLarge =
      size > MAX_OPENCODE_ATTACHMENT_BYTES || size > budget;
    if (declaredTooLarge && local.upload) {
      result.uploads.push({ file, size, source: local });
      continue;
    }

    // Reading also catches a stale metadata size. If the bytes do not fit
    // inline, keep them and let the caller upload them to the host.
    const bytes = await local.bytes();
    if (bytes.byteLength === 0) {
      result.skipped.push(file.displayName);
      continue;
    }
    if (
      declaredTooLarge ||
      bytes.byteLength > MAX_OPENCODE_ATTACHMENT_BYTES ||
      bytes.byteLength > budget
    ) {
      result.uploads.push({ file, size: bytes.byteLength, bytes });
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
