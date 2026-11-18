import { tool } from "ai";
import { z } from "zod";

import type { ToolExecutionRecord } from "@/core/types/app-state";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

export const ANNOUNCE_WHEN_DONE_TOOL_NAME = "announceWhenDone";

export const MAX_ANNOUNCEMENT_MESSAGE_LENGTH = 160;

export type AnnouncementRequest = {
  message: string | null;
};

export function sanitizeAnnouncementMessage(
  input: string | null | undefined,
): string | null {
  if (!input) {
    return null;
  }

  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  if (cleaned.length <= MAX_ANNOUNCEMENT_MESSAGE_LENGTH) {
    return cleaned;
  }

  return `${cleaned
    .slice(0, MAX_ANNOUNCEMENT_MESSAGE_LENGTH - 1)
    .trimEnd()}…`;
}

/**
 * The request lives on the tool record inside the assistant message metadata,
 * so it survives an app restart and run resume without a dedicated column.
 */
export function readAnnouncementRequest(
  records: readonly ToolExecutionRecord[],
): AnnouncementRequest | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];

    if (
      record.toolName === ANNOUNCE_WHEN_DONE_TOOL_NAME &&
      record.status === "completed" &&
      record.announcement
    ) {
      return { message: record.announcement.message ?? null };
    }
  }

  return null;
}

export function createAnnounceWhenDoneTool(input: {
  onArm: (request: AnnouncementRequest) => void;
  onRecord?: (record: ToolExecutionRecord) => void;
}) {
  return {
    tools: {
      [ANNOUNCE_WHEN_DONE_TOOL_NAME]: tool({
        description:
          "Arm a spoken announcement for when this run finishes. Call this tool only when the user explicitly asks to be told, notified, announced, or pinged when the task is done, or asks you to say a specific short phrase on completion. Call it as soon as you understand the request. Pass a message only when the user gave an exact phrase to speak.",
        inputSchema: z.object({
          message: z
            .string()
            .trim()
            .min(1)
            .max(1_000)
            .optional()
            .describe(
              'Optional short phrase to speak when done, e.g. "Parser refactor complete".',
            ),
        }),
        execute: async ({ message }) => {
          const request: AnnouncementRequest = {
            message: sanitizeAnnouncementMessage(message),
          };

          input.onArm(request);
          input.onRecord?.(
            createRecord({
              toolName: ANNOUNCE_WHEN_DONE_TOOL_NAME,
              status: "completed",
              inputSummary: request.message
                ? summarizeValue({ message: request.message })
                : "Default announcement",
              outputSummary: "Announcement armed for when this run finishes.",
              outputData: { message: request.message },
              announcement: request,
            }),
          );

          return {
            armed: true,
            message: request.message,
          };
        },
      }),
    },
  };
}
