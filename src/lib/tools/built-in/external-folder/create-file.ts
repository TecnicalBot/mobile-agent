import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createExternalCreateFileTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Create a new text file inside the granted external folder.",
    inputSchema: z.object({
      content: z.string().default(""),
      path: z.string().trim().min(1),
    }),
    execute: async ({ content, path }) => {
      const inputSummary = summarizeValue({
        path,
        contentPreview: content.slice(0, 200),
      });

      try {
        const output = service.createTextFile(session, path, content);

        onRecord?.(
          createRecord({
            toolName: "createFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "createFile",
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
