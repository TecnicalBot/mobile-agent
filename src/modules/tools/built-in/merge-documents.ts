import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import {
  DOCUMENT_EXTENSIONS,
  getDocumentFormat,
  mergeDocumentSources,
  type DocumentFormat,
} from "@/modules/documents";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

/** Formats that are merged at the source level (pdf has its own page-based tool). */
const SUPPORTED_FORMATS: DocumentFormat[] = ["docx", "pptx", "xlsx"];

export function createMergeDocumentsTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Merge multiple docx, xlsx or pptx workspace files of the same format into a single document, in the order given by fileIds. Content is concatenated and the first file's styling/spec is kept. Creates one new workspace file and leaves the source files untouched. The merged file keeps an editable stored source. For pdf files use mergePdfs. Returns the created file.",
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

        const formats = files.map((file) =>
          getDocumentFormat(file.displayName),
        );

        for (const [index, format] of formats.entries()) {
          if (!format || !SUPPORTED_FORMATS.includes(format)) {
            throw new Error(
              `${files[index]!.displayName} is not a docx, xlsx or pptx file; mergeDocuments works on those formats. For pdf files use mergePdfs.`,
            );
          }
        }

        const format = formats[0]!;

        if (formats.some((candidate) => candidate !== format)) {
          throw new Error(
            "mergeDocuments requires all files to share the same format (docx, xlsx or pptx).",
          );
        }

        const sources: string[] = [];

        for (const file of files) {
          sources.push(await workspaceService.readDocumentSource(file));
        }

        const merged = mergeDocumentSources({ sources });
        const extension = DOCUMENT_EXTENSIONS[format];
        const baseName = files[0]!.displayName.toLowerCase().endsWith(extension)
          ? files[0]!.displayName.slice(0, -extension.length)
          : files[0]!.displayName;
        const requestedName = name?.trim() || `${baseName}-merged`;
        const displayName = requestedName.toLowerCase().endsWith(extension)
          ? requestedName
          : `${requestedName}${extension}`;
        const createdFile = await workspaceService.createDocumentFromMarkdown({
          format,
          name: displayName,
          source: merged,
          sourceSpec: files[0]!.sourceSpec,
        });

        const output = {
          fileId: createdFile.id,
          displayName: createdFile.displayName,
          link: `workspace://${createdFile.id}`,
          size: createdFile.size,
          format,
          sourceFileIds: fileIds,
        };

        onRecord?.(
          createRecord({
            toolName: "mergeDocuments",
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
            toolName: "mergeDocuments",
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
