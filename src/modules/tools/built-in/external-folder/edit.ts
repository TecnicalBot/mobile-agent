import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import { applyTextEdits } from "@/modules/tools/built-in/edits";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";

export function createExternalEditTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description:
      "Apply targeted text edits to a file inside the granted external folder. Each edit must be unique in the file; read the file first and include enough surrounding text. Set replaceAll to true to replace every occurrence of oldText.",
    inputSchema: z.object({
      edits: z
        .array(
          z.object({
            newText: z.string(),
            oldText: z.string(),
            replaceAll: z.boolean().optional(),
          }),
        )
        .min(1),
      path: z.string().trim().min(1),
    }),
    execute: async ({ edits, path }) => {
      const inputSummary = summarizeValue({
        edits: edits.map((edit) => ({
          newTextLength: edit.newText.length,
          oldTextLength: edit.oldText.length,
          replaceAll: edit.replaceAll ?? false,
        })),
        path,
      });

      try {
        const current = await service.readTextFile(session, path);
        const result = applyTextEdits(current, edits);
        await service.writeTextFile(session, path, result.content);

        const output = {
          editsApplied: result.appliedCount,
          path,
        };

        onRecord?.(
          createRecord({
            toolName: "edit",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "edit",
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
