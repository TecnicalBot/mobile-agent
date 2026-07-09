import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createMoveEntryTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Move or rename a file or folder inside the granted external folder.",
    inputSchema: z.object({
      fromPath: z.string().trim().min(1),
      toPath: z.string().trim().min(1),
    }),
    execute: async ({ fromPath, toPath }) => {
      const inputSummary = summarizeValue({ fromPath, toPath });

      try {
        const output = await service.moveEntry(session, fromPath, toPath);

        onRecord?.(
          createRecord({
            toolName: "moveEntry",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "moveEntry",
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
