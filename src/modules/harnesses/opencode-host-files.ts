import { sanitizeFileName } from "@/core/services/file-names";
import {
  normalizeOpenCodeUrl,
  type OpenCodeConnection,
} from "@/modules/harnesses/opencode";
import type { ResolvedAttachmentFile } from "@/modules/harnesses/opencode-attachments";

/** Keep host upload folders valid even if the server sends an unexpected tmp path. */
function pathSegment(value: string, fallback: string) {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || fallback;
}

export function openCodeHostUploadPath(input: {
  temporaryRoot: string;
  uploadID: string;
  fileName: string;
}) {
  const root = input.temporaryRoot.replace(/[\\/]+$/, "");
  return `${root}/uploads/mobile-agent/${pathSegment(input.uploadID, "upload")}/${pathSegment(sanitizeFileName(input.fileName), "attachment")}`;
}

function authHeaders(connection: OpenCodeConnection) {
  if (!connection.password) return undefined;
  return {
    Authorization: `Basic ${btoa(`${connection.username || "opencode"}:${connection.password}`)}`,
  };
}

/**
 * OpenCode rejects attachments over 20 MiB. Its own desktop client avoids that
 * by writing the file to the server's temporary directory and telling the model
 * to read it with tools. This mirrors that path for phone workspace files.
 */
export async function uploadOpenCodeHostFile(input: {
  connection: OpenCodeConnection;
  transport: typeof globalThis.fetch;
  directory?: string | null;
  temporaryRoot: string;
  uploadID: string;
  fileName: string;
  bytes?: Uint8Array;
  source?: ResolvedAttachmentFile;
  signal?: AbortSignal;
}): Promise<string> {
  if (!input.bytes && !input.source?.upload)
    throw new Error("No file data was available to upload.");

  const url = new URL(
    "/api/experimental/fs/write",
    normalizeOpenCodeUrl(input.connection.url, input.connection),
  );
  url.searchParams.set(
    "path",
    openCodeHostUploadPath({
      temporaryRoot: input.temporaryRoot,
      uploadID: input.uploadID,
      fileName: input.fileName,
    }),
  );
  const directory = input.directory?.trim();
  if (directory) url.searchParams.set("location[directory]", directory);
  const headers = {
    "content-type": "application/octet-stream",
    ...authHeaders(input.connection),
  };

  let status: number;
  let responseBody: string;
  if (input.source?.upload) {
    // Native file upload streams from disk; the bytes never enter the JS heap.
    const result = await input.source.upload(url.toString(), {
      httpMethod: "POST",
      uploadType: 0,
      headers,
      signal: input.signal,
    });
    status = result.status;
    responseBody = result.body;
  } else {
    const response = await input.transport(url.toString(), {
      method: "POST",
      headers,
      body: input.bytes as BodyInit,
      redirect: "error",
      signal: input.signal,
    });
    status = response.status;
    responseBody = await response.text().catch(() => "");
  }

  if (status < 200 || status >= 300) {
    const detail = responseBody.trim().slice(0, 200);
    throw new Error(
      `OpenCode could not receive ${input.fileName} (HTTP ${status})${detail ? `: ${detail}` : ""}`,
    );
  }

  let body: { data?: { path?: unknown } } | null = null;
  try {
    body = JSON.parse(responseBody) as { data?: { path?: unknown } };
  } catch {
    body = null;
  }
  const path = body?.data?.path;
  if (typeof path !== "string" || !path.trim())
    throw new Error("OpenCode did not return the uploaded file path.");
  return path;
}
