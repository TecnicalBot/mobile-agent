import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 100;
const MAX_CHARS_PER_FILE = 20_000;
const MAX_LINE_LENGTH = 500;
const MAX_DEPTH = 6;
const MAX_FILES_SCANNED = 150;

const BINARY_MIME_PREFIXES = ["image/", "video/", "audio/"];

function isLikelyBinary(mimeType: string | null) {
  if (!mimeType) {
    return false;
  }

  if (
    BINARY_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    mimeType === "application/octet-stream"
  ) {
    return true;
  }

  return false;
}

export function createExternalSearchTextTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description:
      "Search file contents inside the granted external folder. Returns matching file paths with line numbers; set includeContent to return the matching line text. Read-only.",
    inputSchema: z.object({
      includeContent: z.boolean().optional(),
      maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional(),
      path: z.string().trim().optional(),
      query: z.string().trim().min(2).max(200),
    }),
    execute: async ({ includeContent, maxResults, path, query }) => {
      const inputSummary = summarizeValue({
        path: path ?? null,
        query,
        maxResults: maxResults ?? null,
      });

      try {
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const matches: {
          content: string | null;
          line: number;
          path: string;
        }[] = [];
        const seen = new Set<string>();
        const queryLower = query.trim().toLowerCase();

        const walk = async (currentPath: string, depth: number) => {
          if (
            matches.length >= limit ||
            depth > MAX_DEPTH ||
            seen.size >= MAX_FILES_SCANNED
          ) {
            return;
          }

          const entries = service.listEntries(session, currentPath);

          for (const entry of entries) {
            if (matches.length >= limit || seen.size >= MAX_FILES_SCANNED) {
              return;
            }

            if (entry.kind === "directory") {
              await walk(entry.path, depth + 1);
              continue;
            }

            if (seen.has(entry.path) || isLikelyBinary(entry.mimeType)) {
              continue;
            }

            seen.add(entry.path);

            let text: string;

            try {
              text = await service.readTextFile(
                session,
                entry.path,
                MAX_CHARS_PER_FILE,
              );
            } catch {
              continue;
            }

            const lines = text.split("\n");

            for (let index = 0; index < lines.length; index += 1) {
              if (matches.length >= limit) {
                return;
              }

              if (!lines[index].toLowerCase().includes(queryLower)) {
                continue;
              }

              matches.push({
                content: includeContent
                  ? lines[index].trim().slice(0, MAX_LINE_LENGTH)
                  : null,
                line: index + 1,
                path: entry.path,
              });
            }
          }
        };

        await walk(path?.trim() ?? "", 0);

        const output = {
          matches: matches.map((match) =>
            includeContent
              ? match
              : {
                  line: match.line,
                  path: match.path,
                },
          ),
          truncated: matches.length >= limit,
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
