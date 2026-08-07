import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 100;
const MAX_CHARS_PER_FILE = 20_000;
const MAX_LINE_LENGTH = 500;

function findMatches(input: {
  content: string;
  includeContent: boolean;
  query: string;
}) {
  const query = input.query.trim().toLowerCase();
  const matches: { content: string | null; line: number }[] = [];

  if (!query) {
    return matches;
  }

  const lines = input.content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().includes(query)) {
      matches.push({
        content: input.includeContent
          ? lines[index].trim().slice(0, MAX_LINE_LENGTH)
          : null,
        line: index + 1,
      });
    }
  }

  return matches;
}

export function createSearchTextTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);

  return tool({
    description:
      "Search file contents in the workspace. Returns matching file paths with line numbers; set includeContent to return the matching line text. Read-only.",
    inputSchema: z.object({
      includeContent: z.boolean().optional(),
      maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional(),
      query: z.string().trim().min(2).max(200),
    }),
    execute: async ({ includeContent, maxResults, query }) => {
      const inputSummary = summarizeValue({ query, maxResults: maxResults ?? null });

      try {
        const files = await repository.list();
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const results: {
          content: string | null;
          displayName: string;
          fileId: string;
          line: number;
        }[] = [];

        for (const file of files) {
          if (results.length >= limit) {
            break;
          }

          let text: string;

          try {
            text = await workspaceService.readTextFile(file);
          } catch {
            continue;
          }

          const matches = findMatches({
            content: text.slice(0, MAX_CHARS_PER_FILE),
            includeContent: includeContent ?? false,
            query,
          });

          for (const match of matches) {
            results.push({
              content: match.content,
              displayName: file.displayName,
              fileId: file.id,
              line: match.line,
            });

            if (results.length >= limit) {
              break;
            }
          }
        }

        const output = {
          matches: results.map((match) =>
            includeContent
              ? match
              : {
                  displayName: match.displayName,
                  fileId: match.fileId,
                  line: match.line,
                },
          ),
          truncated: results.length >= limit,
        };

        onRecord?.(
          createRecord({
            toolName: "searchText",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue({
              count: output.matches.length,
              truncated: output.truncated,
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "searchText",
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
