import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/lib/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/lib/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/lib/tools/built-in/external-folder/types";

export function createExternalWriteFileTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Write text content into a file inside the granted external folder.",
    inputSchema: z.object({
      content: z.string(),
      mode: z.enum(["append", "overwrite"]).default("overwrite"),
      path: z.string().trim().min(1),
    }),
    execute: async ({ content, mode, path }) => {
      const inputSummary = summarizeValue({
        path,
        mode,
        contentPreview: content.slice(0, 200),
      });

      try {
        const output = service.writeTextFile(session, path, content, mode);

        onRecord?.(
          createRecord({
            toolName: "writeFile",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "writeFile",
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
