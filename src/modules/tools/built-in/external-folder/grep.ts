import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import {
  formatGrepMatches,
  matchesGlob,
  scanFilesForQuery,
} from "@/modules/tools/built-in/search-core";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 100;
const MAX_CHARS_PER_FILE = 20_000;
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

export function createExternalGrepTool({
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description:
      "Search file contents inside the granted external folder. Returns matching file paths with line numbers; set includeContent to return the matching line text. Use glob to restrict the search to files whose path matches the pattern (supports *, ** and ?). Read-only.",
    inputSchema: z.object({
      glob: z.string().trim().max(200).optional(),
      includeContent: z.boolean().optional(),
      maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional(),
      path: z.string().trim().optional(),
      query: z.string().trim().min(2).max(200),
    }),
    execute: async ({ glob, includeContent, maxResults, path, query }) => {
      const inputSummary = summarizeValue({
        glob: glob ?? null,
        path: path ?? null,
        query,
        maxResults: maxResults ?? null,
      });

      try {
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const files: { path: string }[] = [];

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

            if (isLikelyBinary(entry.mimeType)) {
              continue;
            }

            files.push({ path: entry.path });
          }
        };

        await walk(path?.trim() ?? "", 0);

        const scannedFiles = files.filter((file) =>
          matchesGlob(file.path, glob ? [glob] : undefined),
        );
        const { matches, truncated } = await scanFilesForQuery({
          files: scannedFiles,
          includeContent: includeContent ?? false,
          limit,
          maxCharsPerFile: MAX_CHARS_PER_FILE,
          query,
          readTextFile: async (filePath) =>
            service.readTextFile(session, filePath, MAX_CHARS_PER_FILE),
        });

        const visibleMatches = matches.map((match) =>
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
