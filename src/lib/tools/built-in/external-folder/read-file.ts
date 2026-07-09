import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createExternalReadFileTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Read text content from a file inside the granted external folder.",
    inputSchema: z.object({
      maxChars: z.number().int().positive().max(20000).optional(),
      path: z.string().trim().min(1),
    }),
    execute: async ({ maxChars, path }) => {
      const inputSummary = summarizeValue({ maxChars: maxChars ?? null, path });

      try {
        const text = await service.readTextFile(session, path, maxChars);
        const output = { path, text };

        onRecord?.(
          createRecord({
            toolName: "readFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
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
