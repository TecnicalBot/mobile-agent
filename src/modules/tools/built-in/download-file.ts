import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

function isAllowedDownloadUrl(value: string) {
  try {
    return ALLOWED_URL_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function createDownloadFileTool({
  onProgress,
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  return tool({
    description:
      "Download a file from a URL and save it into the shared workspace. Supports custom output file name, an optional subfolder, and optional request headers.",
    inputSchema: z.object({
      url: z
        .string()
        .trim()
        .min(1)
        .refine(isAllowedDownloadUrl, {
          message: "URL must use the http:// or https:// scheme.",
        }),
      fileName: z.string().trim().min(1).optional(),
      folderPath: z
        .string()
        .trim()
        .min(1)
        .optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    execute: async ({ url, fileName, folderPath, headers }) => {
      const inputSummary = summarizeValue({
        url,
        fileName: fileName ?? null,
        folderPath: folderPath ?? null,
      });

      try {
        const workspaceService = createWorkspaceFileService(repository);
        const downloadedFile = await workspaceService.downloadFile({
          url,
          name: fileName,
          folderSegments: folderPath ? folderPath.split("/") : undefined,
          headers,
          onProgress,
        });
        const output = {
          id: downloadedFile.id,
          displayName: downloadedFile.displayName,
          mimeType: downloadedFile.mimeType,
          size: downloadedFile.size,
          relativePath: downloadedFile.relativePath,
        };

        onRecord?.(
          createRecord({
            toolName: "downloadFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "downloadFile",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
  });
}
