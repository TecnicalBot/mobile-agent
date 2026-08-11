import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import {
  formatGlobFiles,
  matchesGlob,
} from "@/modules/tools/built-in/search-core";

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_LIMIT = 500;
const MAX_DEPTH = 8;
const MAX_FILES_SCANNED = 500;

export function createExternalGlobTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description:
      "Find files inside the granted external folder by glob pattern. Returns concise file paths relative to the folder root. Supports * (within a folder segment), ** (across folders) and ?. For example **/*.ts matches .ts files in any folder while *.ts only matches files at the root. Read-only.",
    inputSchema: z.object({
      maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional(),
      path: z.string().trim().optional(),
      pattern: z.string().trim().min(1).max(200),
    }),
    execute: async ({ maxResults, path, pattern }) => {
      const inputSummary = summarizeValue({
        path: path ?? null,
        pattern,
      });

      try {
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const files: string[] = [];

        const walk = async (currentPath: string, depth: number) => {
          if (depth > MAX_DEPTH || files.length >= MAX_FILES_SCANNED) {
            return;
          }

          const entries = service.listEntries(session, currentPath);

          for (const entry of entries) {
            if (files.length >= MAX_FILES_SCANNED) {
              return;
            }

            if (entry.kind === "directory") {
              await walk(entry.path, depth + 1);
              continue;
            }

            files.push(entry.path);
          }
        };

        await walk(path?.trim() ?? "", 0);

        const matchingPaths = files
          .filter((filePath) => matchesGlob(filePath, [pattern]))
          .slice(0, limit);

        const output = { files: matchingPaths };

        onRecord?.(
          createRecord({
            toolName: "glob",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue({
              count: matchingPaths.length,
              files: formatGlobFiles(matchingPaths),
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "glob",
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
