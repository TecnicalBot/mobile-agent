import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { applyTextEdits } from "@/modules/tools/built-in/edits";

export function createEditTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Apply targeted text edits to a workspace file. Each edit must be unique in the file; read the file first and include enough surrounding text. Set replaceAll to true to replace every occurrence of oldText. Rewrites only the changed regions.",
    inputSchema: z.object({
      edits: z
        .array(
          z.object({
            newText: z.string(),
            oldText: z.string(),
            replaceAll: z.boolean().optional(),
          }),
        )
        .min(1),
      fileId: z.string().min(1),
    }),
    execute: async ({ edits, fileId }) => {
      const inputSummary = summarizeValue({
        edits: edits.map((edit) => ({
          newTextLength: edit.newText.length,
          oldTextLength: edit.oldText.length,
          replaceAll: edit.replaceAll ?? false,
        })),
        fileId,
      });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        const current = await workspaceService.readTextFile(file);
        const result = applyTextEdits(current, edits);
        await workspaceService.writeTextFile(file, result.content);

        const output = {
          displayName: file.displayName,
          editsApplied: result.appliedCount,
          fileId,
        };

        onRecord?.(
          createRecord({
            toolName: "edit",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "edit",
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
