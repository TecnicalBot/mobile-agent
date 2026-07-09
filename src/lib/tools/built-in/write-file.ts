import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/lib/tools/built-in/types";
import { createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";

export function createWriteFileTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description: "Write text content into a workspace file.",
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
            toolName: "writeFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "writeFile",
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
