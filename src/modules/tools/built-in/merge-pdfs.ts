import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { mergePdfFiles } from "@/modules/documents/pdf-tools";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

const PDF_EXTENSION = ".pdf";

export function createMergePdfsTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Merge multiple pdf workspace files into a single pdf, in the order given by fileIds. Creates one new workspace file and leaves the source files untouched. Returns the created file.",
    inputSchema: z.object({
      fileIds: z.array(z.string().min(1)).min(2).max(20),
      name: z.string().trim().min(1).max(150).optional(),
    }),
    execute: async ({ fileIds, name }) => {
      const inputSummary = summarizeValue({ fileIds, name: name ?? null });

      try {
        const files = await repository.getByIds(fileIds);

        if (files.length !== fileIds.length) {
          const missing = fileIds.filter(
            (fileId) => !files.some((file) => file.id === fileId),
          );
          throw new Error(`No workspace files found: ${missing.join(", ")}`);
        }

        for (const file of files) {
          const lowerName = file.displayName.toLowerCase();

          if (
            !lowerName.endsWith(PDF_EXTENSION) &&
            file.mimeType !== "application/pdf"
          ) {
            throw new Error(
              `${file.displayName} is not a pdf file; mergePdfs works on pdf files only.`,
            );
          }
        }

        const pdfBytes = [];

        for (const file of files) {
          pdfBytes.push(await workspaceService.readDocumentBytes(file));
        }

        const { bytes, pageCount } = await mergePdfFiles({ files: pdfBytes });
        const baseName = name?.trim() || "merged";
        const displayName = baseName.toLowerCase().endsWith(PDF_EXTENSION)
          ? baseName
          : `${baseName}${PDF_EXTENSION}`;
        const createdFile = await workspaceService.createDocumentFile({
          bytes,
          mimeType: "application/pdf",
          name: displayName,
        });

        const output = {
          fileId: createdFile.id,
          displayName: createdFile.displayName,
          link: `workspace://${createdFile.id}`,
          size: createdFile.size,
          pageCount,
          sourceFileIds: fileIds,
        };

        onRecord?.(
          createRecord({
            toolName: "mergePdfs",
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
            toolName: "mergePdfs",
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