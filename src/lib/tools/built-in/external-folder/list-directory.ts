import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createListDirectoryTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "List files and folders inside the granted external folder.",
    inputSchema: z.object({
      path: z.string().trim().optional(),
    }),
    execute: async ({ path }) => {
      const inputSummary = summarizeValue({ path: path ?? "" });

      try {
        const entries = service.listEntries(session, path ?? "");
        const output = { entries };

        onRecord?.(
          createRecord({
            toolName: "listDirectory",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "listDirectory",
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
