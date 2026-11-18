import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { splitPdfPages } from "@/modules/documents/pdf-tools";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

const PDF_EXTENSION = ".pdf";

export function createSplitPdfTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Split a pdf workspace file into multiple pdf files by page ranges. Specify ranges as comma-separated 1-based ranges, for example \"1-3,5,7-9\" (single page \"5\", open-ended \"2-\" or \"-6\", or \"all\" are also accepted). Every range becomes its own new pdf file. Creates new workspace files; the source file is left untouched. Returns the created files.",
    inputSchema: z.object({
      fileId: z.string().min(1),
      pageRanges: z.string().trim().min(1).max(100),
    }),
    execute: async ({ fileId, pageRanges }) => {
      const inputSummary = summarizeValue({ fileId, pageRanges });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        const lowerName = file.displayName.toLowerCase();

        if (
          !lowerName.endsWith(PDF_EXTENSION) &&
          file.mimeType !== "application/pdf"
        ) {
          throw new Error(
            `${file.displayName} is not a pdf file; splitPdf works on pdf files only.`,
          );
        }

        const bytes = await workspaceService.readDocumentBytes(file);
        const { pageCount, parts } = await splitPdfPages({
          bytes,
          spec: pageRanges,
        });
        const baseName = lowerName.endsWith(PDF_EXTENSION)
          ? file.displayName.slice(0, -PDF_EXTENSION.length)
          : file.displayName;

        const created = [];

        for (const [index, partBytes] of parts.entries()) {
          const displayName = `${baseName}-part-${index + 1}${PDF_EXTENSION}`;
          const createdFile = await workspaceService.createDocumentFile({
            bytes: partBytes,
            mimeType: "application/pdf",
            name: displayName,
          });
          created.push({
            fileId: createdFile.id,
            displayName: createdFile.displayName,
            link: `workspace://${createdFile.id}`,
            size: createdFile.size,
            part: index + 1,
          });
        }

        const output = {
          created,
          pageCount,
          sourceFileId: file.id,
          sourceDisplayName: file.displayName,
        };

        onRecord?.(
          createRecord({
            toolName: "splitPdf",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          outputData: output,
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "splitPdf",
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