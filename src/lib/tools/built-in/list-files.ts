import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/lib/tools/built-in/types";
import { isTextWorkspaceFile } from "@/lib/workspace/workspace-file-service";

export function createListFilesTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  return tool({
    description: "List files that are available in the shared workspace.",
    inputSchema: z.object({
      query: z.string().trim().min(1).optional(),
    }),
    execute: async ({ query }) => {
      const inputSummary = summarizeValue({ query: query ?? null });

      try {
        const files = await repository.list();
        const normalizedQuery = query?.toLowerCase() ?? "";
        const filteredFiles = normalizedQuery
          ? files.filter((file) =>
              file.displayName.toLowerCase().includes(normalizedQuery),
            )
          : files;
        const output = {
          files: filteredFiles.map((file) => ({
            id: file.id,
            displayName: file.displayName,
            mimeType: file.mimeType,
            size: file.size,
            isText: isTextWorkspaceFile(file),
          })),
        };

        onRecord?.(
          createRecord({
            toolName: "listFiles",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "listFiles",
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
