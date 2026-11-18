import { tool } from "ai";
import { z } from "zod";

import { getDocumentFormat } from "@/modules/documents";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

const SECTION_MODES = [
  "replace",
  "insertBefore",
  "insertAfter",
  "append",
  "delete",
] as const;

export function createUpdateDocumentTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Update an existing document (docx, pdf, pptx, xlsx) in place. Two modes: (1) Whole document — pass content with new Markdown or plain text and the stored source is replaced. (2) Section — pass section (a 0-based index from the read sections list) and content to rewrite just that heading-delimited section of a large document; content must start with a Markdown heading. Use sectionMode to insertBefore, insertAfter, append a new section, or delete a section. Read the document first: read returns its stored source as sourceMarkdown (or a sections list for large documents). The document keeps its file name and format. Content rules match createFile (Markdown headings become titles/slides, pipe tables become tables, --- starts a new page/slide). The stored source keeps its YAML front-matter format spec, so styling survives updates; pass a spec parameter to restyle.",
    inputSchema: z.object({
      fileId: z.string().min(1),
      content: z.string().optional(),
      spec: z.record(z.string(), z.unknown()).optional(),
      section: z.number().int().min(0).optional(),
      sectionMode: z.enum(SECTION_MODES).optional(),
    }),
    execute: async ({ content, fileId, spec, section, sectionMode }) => {
      const mode = sectionMode ?? (section !== undefined ? "replace" : null);
      const inputSummary = summarizeValue({
        fileId,
        specProvided: spec !== undefined,
        section,
        sectionMode: mode,
        contentPreview: content ? content.slice(0, 200) : null,
      });

      try {
        const file = await repository.getById(fileId);

        if (!file) {
          throw new Error(`No workspace file found for ${fileId}.`);
        }

        // Whole-document replacement.
        if (mode === null) {
          if (!content) {
            throw new Error(
              "content is required to replace the whole document, or pass section/sectionMode to edit a single section.",
            );
          }

          const nextFile = await workspaceService.updateDocumentFile(
            file,
            content,
            spec,
          );
          const output = {
            fileId: nextFile.id,
            displayName: nextFile.displayName,
            format: getDocumentFormat(nextFile.displayName),
            link: `workspace://${nextFile.id}`,
            size: nextFile.size,
          };

          onRecord?.(
            createRecord({
              toolName: "updateDocument",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue(output),
              outputData: output,
            }),
          );

          return output;
        }

        if (mode !== "delete" && !content) {
          throw new Error(`content is required for section mode ${mode}.`);
        }

        const result = await workspaceService.updateDocumentSection(file, {
          mode,
          section,
          content,
          spec,
        });

        const output = {
          fileId: result.file.id,
          displayName: result.file.displayName,
          format: getDocumentFormat(result.file.displayName),
          link: `workspace://${result.file.id}`,
          size: result.file.size,
          sectionMode: mode,
          section: section ?? null,
          sections: result.sections.map((entry) => ({
            index: entry.position,
            level: entry.level,
            title: entry.title,
            chars: entry.charCount,
          })),
        };

        onRecord?.(
          createRecord({
            toolName: "updateDocument",
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
            toolName: "updateDocument",
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
