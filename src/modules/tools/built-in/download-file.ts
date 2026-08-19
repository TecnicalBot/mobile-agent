import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import type { ExternalFolderSession } from "@/core/types/app-state";
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

type DownloadFileToolFactoryParams = WorkspaceToolFactoryParams & {
  session?: ExternalFolderSession | null;
};

export function createDownloadFileTool({
  onProgress,
  onRecord,
  repository,
  session,
}: DownloadFileToolFactoryParams) {
  return tool({
    description:
      "Download a file from a URL and save it. Use target \"workspace\" to save into the shared workspace, optionally inside a workspace subfolder (folderPath). Use target \"folder\" to save into the granted external folder: omit destinationPath to save at the granted folder root, or set destinationPath to an existing subfolder path relative to the granted folder root. downloadFile never creates folders, so any destinationPath must already exist.",
    inputSchema: z.object({
      url: z
        .string()
        .trim()
        .min(1)
        .refine(isAllowedDownloadUrl, {
          message: "URL must use the http:// or https:// scheme.",
        }),
      fileName: z.string().trim().min(1).optional(),
      target: z
        .enum(["workspace", "folder"])
        .optional()
        .describe(
          "Where to save the download: workspace (default) or folder (the granted external folder).",
        ),
      folderPath: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Workspace subfolder, used only when target is workspace."),
      destinationPath: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Subfolder path relative to the granted external folder root, used only when target is folder. It must already exist. Omit to save at the granted folder root.",
        ),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    execute: async ({
      url,
      fileName,
      folderPath,
      destinationPath,
      target,
      headers,
    }) => {
      const inputSummary = summarizeValue({
        url,
        fileName: fileName ?? null,
        folderPath: folderPath ?? null,
        destinationPath: destinationPath ?? null,
        target: target ?? "workspace",
      });

      try {
        const folderTarget = target === "folder" || Boolean(destinationPath);

        if (folderTarget) {
          if (!session) {
            throw new Error(
              "Downloading to an external folder requires folder access. Grant a folder first, or set target to workspace (or omit target and destinationPath) to save into the workspace.",
            );
          }

          const folderService = createExternalFolderService();
          const downloaded = await folderService.downloadFile(session, {
            url,
            name: fileName,
            folderPath: destinationPath,
            headers,
            onProgress,
          });
          const output = {
            displayName: downloaded.name,
            mimeType: downloaded.mimeType,
            size: downloaded.size,
            path: downloaded.path,
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
        }

        const workspaceService = createWorkspaceFileService(repository);
        const downloadedFile = await workspaceService.downloadFile({
          url,
          name: fileName,
          folderSegments: folderPath
            ? folderPath
                .split("/")
                .map((segment) => segment.trim())
                .filter(Boolean)
            : undefined,
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
