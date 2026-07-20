import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createCreateDirectoryTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Create a folder inside the granted external folder.",
    inputSchema: z.object({
      path: z.string().trim().min(1),
    }),
    execute: async ({ path }) => {
      const inputSummary = summarizeValue({ path });

      try {
        const output = await service.createDirectory(session, path);

        onRecord?.(
          createRecord({
            toolName: "createDirectory",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "createDirectory",
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
