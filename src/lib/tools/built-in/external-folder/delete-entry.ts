import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createDeleteEntryTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Delete a file or folder inside the granted external folder.",
    inputSchema: z.object({
      path: z.string().trim().min(1),
      recursive: z.boolean().default(false),
    }),
    execute: async ({ path, recursive }) => {
      const inputSummary = summarizeValue({ path, recursive });

      try {
        const output = service.deleteEntry(session, path, recursive);

        onRecord?.(
          createRecord({
            toolName: "deleteEntry",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "deleteEntry",
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
