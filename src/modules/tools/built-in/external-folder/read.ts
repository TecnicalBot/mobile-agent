import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";

export function createExternalReadTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description:
      "Read text content from a file inside the granted external folder. Use offset to page through large files: set offset to a character position and the content is returned starting there.",
    inputSchema: z.object({
      maxChars: z.number().int().positive().max(20000).optional(),
      offset: z.number().int().min(0).optional(),
      path: z.string().trim().min(1),
    }),
    execute: async ({ maxChars, offset, path }) => {
      const inputSummary = summarizeValue({
        maxChars: maxChars ?? null,
        offset: offset ?? null,
        path,
      });

      try {
        const text = await service.readTextFile(session, path);
        const start = offset ?? 0;
        const size = maxChars ?? 8000;
        const content = text.slice(start, start + size);
        const output = {
          content,
          offset: start,
          path,
          totalChars: text.length,
          truncated: text.length > start + size,
        };

        onRecord?.(
          createRecord({
            toolName: "read",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
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
