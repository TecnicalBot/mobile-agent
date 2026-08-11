import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import {
  formatGlobFiles,
  matchesGlob,
} from "@/modules/tools/built-in/search-core";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_LIMIT = 500;

export function createGlobTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  return tool({
    description:
      "Find files in the workspace by glob pattern. Returns concise file paths relative to the workspace root. Supports * (within a folder segment), ** (across folders) and ?. For example **/*.ts matches .ts files in any folder while *.ts only matches files at the root. Read-only.",
    inputSchema: z.object({
      maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional(),
      pattern: z.string().trim().min(1).max(200),
    }),
    execute: async ({ maxResults, pattern }) => {
      const inputSummary = summarizeValue({ pattern });

      try {
        const files = await repository.list();
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const matchingPaths = files
          .filter((file) => matchesGlob(file.relativePath, [pattern]))
          .map((file) => file.relativePath)
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
