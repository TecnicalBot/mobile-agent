import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createRenameEntryTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Rename a file or folder inside the granted external folder.",
    inputSchema: z.object({
      newName: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    execute: async ({ newName, path }) => {
      const inputSummary = summarizeValue({ newName, path });

      try {
        const output = await service.renameEntry(session, path, newName);

        onRecord?.(
          createRecord({
            toolName: "renameEntry",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "renameEntry",
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
