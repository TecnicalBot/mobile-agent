import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import {
  formatGrepMatches,
  matchesGlob,
  scanFilesForQuery,
} from "@/modules/tools/built-in/search-core";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 100;

export function createGrepTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Search file contents in the workspace. Returns matching file paths with line numbers; set includeContent to return the matching line text. Use glob to restrict the search to files whose path matches the pattern (supports *, ** and ?). Read-only.",
    inputSchema: z.object({
      glob: z.string().trim().max(200).optional(),
      includeContent: z.boolean().optional(),
      maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional(),
      query: z.string().trim().min(2).max(200),
    }),
    execute: async ({ glob, includeContent, maxResults, query }) => {
      const inputSummary = summarizeValue({
        glob: glob ?? null,
        query,
        maxResults: maxResults ?? null,
      });

      try {
        const files = await repository.list();
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const matchingFiles = files.filter((file) =>
          matchesGlob(file.relativePath, glob ? [glob] : undefined),
        );
        const { matches, truncated } = await scanFilesForQuery({
          files: matchingFiles.map((file) => ({
            fileId: file.id,
            path: file.relativePath,
          })),
          includeContent: includeContent ?? false,
          limit,
          query,
          readTextFile: async (path) => {
            const file = matchingFiles.find(
              (candidate) => candidate.relativePath === path,
            );

            if (!file) {
              throw new Error(`No workspace file found for ${path}.`);
            }

            return workspaceService.readTextFile(file);
          },
        });

        const visibleMatches = matches
          .map((match) =>
            includeContent
              ? {
                  content: match.content,
                  line: match.line,
                  path: match.path,
                }
              : {
                  line: match.line,
                  path: match.path,
                },
          );

        const output = {
          matches: visibleMatches,
          truncated,
        };

        onRecord?.(
          createRecord({
            toolName: "grep",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue({
              count: visibleMatches.length,
              truncated: output.truncated,
              matches: formatGrepMatches(matches, includeContent),
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "grep",
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
