import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/lib/tools/built-in/types";
import { createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";

export function createReadFileTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description: "Read text content from a workspace file.",
    inputSchema: z.object({
      fileId: z.string().min(1),
      maxChars: z.number().int().min(100).max(20000).optional(),
    }),
    execute: async ({ fileId, maxChars }) => {
      const inputSummary = summarizeValue({ fileId, maxChars: maxChars ?? null });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        const text = await workspaceService.readTextFile(file);
        const output = {
          fileId: file.id,
          displayName: file.displayName,
          content: text.slice(0, maxChars ?? 8000),
          truncated: text.length > (maxChars ?? 8000),
        };

        onRecord?.(
          createRecord({
            toolName: "readFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue({
              fileId: output.fileId,
              displayName: output.displayName,
              truncated: output.truncated,
              contentPreview: output.content.slice(0, 200),
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "readFile",
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
