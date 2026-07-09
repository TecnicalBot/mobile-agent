import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/lib/tools/built-in/types";
import { createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";

export function createCreateFileTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description: "Create a new text file in the shared workspace.",
    inputSchema: z.object({
      name: z.string().min(1),
      content: z.string().default(""),
    }),
    execute: async ({ content, name }) => {
      const inputSummary = summarizeValue({
        name,
        contentPreview: content.slice(0, 200),
      });

      try {
        const file = await workspaceService.createTextFile({
          name,
          content,
        });
        const output = {
          fileId: file.id,
          displayName: file.displayName,
          size: file.size,
        };

        onRecord?.(
          createRecord({
            toolName: "createFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "createFile",
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
