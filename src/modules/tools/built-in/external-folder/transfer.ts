import { tool } from "ai";
import { z } from "zod";

import type { WorkspaceRepository } from "@/core/db/database";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import {
  createWorkspaceFileService,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type {
  ExternalFolderSession,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

export type TransferToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
  repository: WorkspaceRepository;
  session: ExternalFolderSession;
};

export function createTransferTools(params: TransferToolFactoryParams) {
  const folderService = createExternalFolderService();
  const workspaceService = createWorkspaceFileService(params.repository);

  return {
    exportWorkspaceFileToFolder: tool({
      description:
        "Copy a workspace file into the granted phone-storage folder. Use when the user asks to move, copy, save, or export a workspace file into this folder. For a move, the workspace copy is deleted after the folder copy succeeds.",
      inputSchema: z.object({
        destinationPath: z
          .string()
          .trim()
          .min(1)
          .describe("Destination path relative to the granted folder root."),
        fileId: z
          .string()
          .trim()
          .min(1)
          .describe("The workspace file id returned by listFiles."),
        mode: z
          .enum(["copy", "move"])
          .default("copy")
          .describe("copy keeps the workspace file, move deletes it."),
      }),
      execute: async ({ destinationPath, fileId, mode }) => {
        const inputSummary = summarizeValue({
          fileId,
          destinationPath,
          mode,
        });

        try {
          const workspaceFile = await params.repository.getById(fileId);

          if (!workspaceFile) {
            throw new Error(
              `No workspace file found for ${fileId}. Use listFiles to find workspace files.`,
            );
          }

          const sourceFile = resolveWorkspaceFile(workspaceFile.relativePath);

          if (!sourceFile.exists) {
            throw new Error(
              `${workspaceFile.displayName} is no longer available in the workspace.`,
            );
          }

          const bytes = await sourceFile.bytes();
          const output = await folderService.writeBytesFile(
            params.session,
            destinationPath,
            bytes,
            workspaceFile.mimeType ?? undefined,
          );

          if (mode === "move") {
            await workspaceService.deleteFile(workspaceFile);
          }

          const result = {
            workspaceFileId: workspaceFile.id,
            displayName: workspaceFile.displayName,
            destinationPath: output.path,
            size: output.size,
            mode,
          };

          params.onRecord?.(
            createRecord({
              toolName: "exportWorkspaceFileToFolder",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue(result),
            }),
          );

          return result;
        } catch (error) {
          params.onRecord?.(
            createRecord({
              toolName: "exportWorkspaceFileToFolder",
              status: "failed",
              inputSummary,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          throw error;
        }
      },
    }),
    importFolderFileToWorkspace: tool({
      description:
        "Copy a file from the granted phone-storage folder into the app workspace. Use when the user asks to move, copy, save, or import a folder file into the workspace. For a move, the folder source is deleted after the workspace copy succeeds.",
      inputSchema: z.object({
        destinationName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional workspace file name. Defaults to the source name."),
        mode: z
          .enum(["copy", "move"])
          .default("copy")
          .describe("copy keeps the folder file, move deletes it."),
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Source path relative to the granted folder root."),
      }),
      execute: async ({ destinationName, mode, path }) => {
        const inputSummary = summarizeValue({ path, mode });

        try {
          const sourceName =
            path.split("/").filter(Boolean).pop() ?? "imported-file";
          const { bytes, mimeType } = await folderService.readBytesFile(
            params.session,
            path,
          );
          const imported = await workspaceService.importBytesFile({
            bytes,
            mimeType,
            name: destinationName || sourceName,
          });

          if (mode === "move") {
            await folderService.deleteEntry(params.session, path);
          }

          const result = {
            workspaceFileId: imported.id,
            displayName: imported.displayName,
            relativePath: imported.relativePath,
            size: imported.size,
            mode,
          };

          params.onRecord?.(
            createRecord({
              toolName: "importFolderFileToWorkspace",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue(result),
            }),
          );

          return result;
        } catch (error) {
          params.onRecord?.(
            createRecord({
              toolName: "importFolderFileToWorkspace",
              status: "failed",
              inputSummary,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          throw error;
        }
      },
    }),
  };
}

export function buildTransferSystemPrompt(session: ExternalFolderSession) {
  return [
    "Files exist in two separate storage areas: the granted external folder and the app workspace.",
    `Granted folder: ${session.displayName}.`,
    "The external folder is browsed with listDirectory using paths relative to the granted folder root.",
    "The workspace is browsed with listFiles, which identifies workspace files by their file id.",
    "To copy or move a file between the two areas, use exportWorkspaceFileToFolder or importFolderFileToWorkspace. Use mode \"move\" only when the user asked to move the file; otherwise keep the source with mode \"copy\".",
    "Do not simulate a transfer by reading a file and writing its text elsewhere.",
  ].join("\n\n");
}
