import { sanitizeFileName } from "@/core/services/file-names";
import type { ResolvedAttachmentFile } from "@/modules/harnesses/opencode-attachments";
import type { AcpConnection } from "@/modules/harnesses/acp-client";

function authHeaders(connection: AcpConnection): Record<string, string> {
  const token = connection.token.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Bridge endpoint for large phone attachments. The host cannot read a phone
 * workspace path, so the bytes are streamed into a session-scoped folder on
 * the bridge host and the prompt references that path instead.
 */
export function acpHostUploadUrl(input: {
  connection: Pick<AcpConnection, "url">;
  directory?: string | null;
  fileName: string;
}) {
  const url = new URL("/files", `${input.connection.url}/`);
  url.searchParams.set("name", sanitizeFileName(input.fileName));
  const directory = input.directory?.trim();
  if (directory) url.searchParams.set("directory", directory);
  return url.toString();
}

export async function uploadAcpHostFile(input: {
  agentLabel: string;
  connection: AcpConnection;
  transport: typeof globalThis.fetch;
  directory?: string | null;
  fileName: string;
  bytes?: Uint8Array;
  source?: ResolvedAttachmentFile;
  signal?: AbortSignal;
}): Promise<string> {
  if (!input.bytes && !input.source?.upload)
    throw new Error("No file data was available to upload.");

  const url = acpHostUploadUrl(input);
  const headers = {
    "content-type": "application/octet-stream",
    ...authHeaders(input.connection),
  };

  let status: number;
  let responseBody: string;
  if (input.source?.upload) {
    // Native upload streams from disk; the bytes never enter the JS heap.
    const result = await input.source.upload(url, {
      httpMethod: "POST",
      uploadType: 0,
      headers,
      signal: input.signal,
    });
    status = result.status;
    responseBody = result.body;
  } else {
    const response = await input.transport(url, {
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
      `The ${input.agentLabel} bridge could not receive ${input.fileName} (HTTP ${status})${detail ? `: ${detail}` : ""}`,
    );
  }

  let body: { path?: unknown } | null = null;
  try {
    body = JSON.parse(responseBody) as { path?: unknown };
  } catch {
    body = null;
  }
  const path = body?.path;
  if (typeof path !== "string" || !path.trim())
    throw new Error(
      `The ${input.agentLabel} bridge did not return the uploaded file path.`,
    );
  return path;
}
