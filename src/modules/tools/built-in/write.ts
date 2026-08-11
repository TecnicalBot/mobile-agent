import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

export function createWriteTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Modify a user-visible workspace file. Use only when the user explicitly asks to update, append to, or overwrite that file. Do not write internal notes or duplicate an answer that belongs in chat.",
    inputSchema: z.object({
      fileId: z.string().min(1),
      content: z.string(),
      mode: z.enum(["append", "overwrite"]).default("overwrite"),
    }),
    execute: async ({ content, fileId, mode }) => {
      const inputSummary = summarizeValue({
        fileId,
        mode,
        contentPreview: content.slice(0, 200),
      });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        const nextFile = await workspaceService.writeTextFile(file, content, mode);
        const output = {
          fileId: nextFile.id,
          displayName: nextFile.displayName,
          size: nextFile.size,
          mode,
        };

        onRecord?.(
          createRecord({
            toolName: "write",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "write",
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
