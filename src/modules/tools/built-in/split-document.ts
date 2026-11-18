import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_MIME_TYPES,
  getDocumentFormat,
  splitDocumentSource,
  splitPptxSlides,
  splitXlsxSheets,
  type DocumentFormat,
} from "@/modules/documents";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

/** Formats that are split at the source level (pdf has its own page-based tool). */
const SUPPORTED_FORMATS: DocumentFormat[] = ["docx", "pptx", "xlsx"];

type CreatedPart = {
  fileId: string;
  displayName: string;
  link: string;
  part: number;
  size: number | null;
  title: string | null;
  sections?: number[];
};

export function createSplitDocumentTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      'Split a docx, xlsx or pptx workspace file into multiple documents. Specify ranges as 0-based indices, for example "0-2,4" (single "3", open-ended "2-" or "-3"); use "each" for one file per unit or "all" to keep everything in one part. Documents with stored source split by heading sections, exactly like the sections list returned by read; imported pptx and xlsx files without stored source are split losslessly by slide/sheet instead. Every range becomes its own new file and the source file is left untouched. For pdf files use splitPdf. Returns the created files.',
    inputSchema: z.object({
      fileId: z.string().min(1),
      sections: z.string().trim().min(1).max(100),
    }),
    execute: async ({ fileId, sections }) => {
      const inputSummary = summarizeValue({ fileId, sections });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        const format = getDocumentFormat(file.displayName);

        if (!format || !SUPPORTED_FORMATS.includes(format)) {
          throw new Error(
            `${file.displayName} is not a docx, xlsx or pptx file; splitDocument works on those formats. For pdf files use splitPdf.`,
          );
        }

        const extension = DOCUMENT_EXTENSIONS[format];
        const baseName = file.displayName.toLowerCase().endsWith(extension)
          ? file.displayName.slice(0, -extension.length)
          : file.displayName;
        const created: CreatedPart[] = [];
        let unit: "section" | "slide" | "sheet" = "section";
        let unitCount = 0;
        let unitNames: string[] = [];

        if (!file.sourceMarkdown && (format === "pptx" || format === "xlsx")) {
          // Imported presentation/workbook without stored source: split the
          // original OOXML package losslessly by slides or sheets.
          const bytes = await workspaceService.readDocumentBytes(file);
          const result =
            format === "pptx"
              ? splitPptxSlides({ bytes, spec: sections })
              : splitXlsxSheets({ bytes, spec: sections });

          unit = format === "pptx" ? "slide" : "sheet";
          unitCount = result.unitCount;
          unitNames = result.unitNames;

          for (const [index, partBytes] of result.parts.entries()) {
            const displayName = `${baseName}-part-${index + 1}${extension}`;
            const createdFile = await workspaceService.createDocumentFile({
              bytes: partBytes,
              mimeType: DOCUMENT_MIME_TYPES[format],
              name: displayName,
            });
            created.push({
              fileId: createdFile.id,
              displayName: createdFile.displayName,
              link: `workspace://${createdFile.id}`,
              size: createdFile.size,
              part: index + 1,
              title: unitNames[index] ?? null,
            });
          }
        } else {
          // Source-level split: exact for agent-created documents, and for
          // imported docx uses the extracted text (kept editable).
          const source = await workspaceService.readDocumentSource(file);
          const { parts, sectionCount } = splitDocumentSource({
            source,
            spec: sections,
          });

          unitCount = sectionCount;

          for (const [index, part] of parts.entries()) {
            const displayName = `${baseName}-part-${index + 1}${extension}`;
            const createdFile =
              await workspaceService.createDocumentFromMarkdown({
                format,
                name: displayName,
                source: part.source,
                sourceSpec: file.sourceSpec,
              });
            created.push({
              fileId: createdFile.id,
              displayName: createdFile.displayName,
              link: `workspace://${createdFile.id}`,
              size: createdFile.size,
              part: index + 1,
              title: part.title || null,
              sections: part.sectionIndices,
            });
          }
        }

        const output = {
          created,
          unit,
          unitCount,
          ...(unitNames.length > 0 ? { unitNames } : {}),
          sourceFileId: file.id,
          sourceDisplayName: file.displayName,
        };

        onRecord?.(
          createRecord({
            toolName: "splitDocument",
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
            toolName: "splitDocument",
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
