import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

export function createReadTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Read text content from a workspace file. Use offset to page through large files: set offset to a character position and the content is returned starting there. Read-only.",
    inputSchema: z.object({
      fileId: z.string().min(1),
      maxChars: z.number().int().min(100).max(20000).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    execute: async ({ fileId, maxChars, offset }) => {
      const inputSummary = summarizeValue({
        fileId,
        maxChars: maxChars ?? null,
        offset: offset ?? null,
      });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        const text = await workspaceService.readTextFile(file);
        const start = offset ?? 0;
        const size = maxChars ?? 8000;
        const content = text.slice(start, start + size);
        const output = {
          fileId: file.id,
          displayName: file.displayName,
          content,
          truncated: text.length > start + size,
          totalChars: text.length,
          offset: start,
        };

        onRecord?.(
          createRecord({
            toolName: "read",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue({
              fileId: output.fileId,
              displayName: output.displayName,
              totalChars: output.totalChars,
              truncated: output.truncated,
              contentPreview: output.content.slice(0, 200),
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "read",
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
