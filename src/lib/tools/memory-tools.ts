import { tool, type ToolSet } from "ai";
import * as Crypto from "expo-crypto";
import { z } from "zod";

import type { MemoryRepository } from "@/lib/db/repositories/types";
import type { MemoryEntry, MemoryEvent } from "@/types/app-state";

export function buildMemorySystemPrompt(
  memories: MemoryEntry[],
  input: { canWrite: boolean },
) {
  const enabledMemories = memories.filter(
    (memory) => memory.enabled && !memory.archivedAt,
  );

  if (enabledMemories.length === 0) {
    return input.canWrite
      ? [
          "Memory is enabled.",
          "Use memory tools only for stable user preferences or facts that will help in future chats.",
          "Do not save one-off requests, secrets, credentials, payment data, or sensitive health, legal, or financial facts unless the user explicitly asks you to remember them.",
        ].join("\n")
      : "Memory is enabled, but no memories have been saved yet.";
  }

  const lines = [
    "Memory:",
    ...enabledMemories.map(
      (memory) => `- ${memory.content} (memory id: ${memory.id})`,
    ),
  ];

  if (!input.canWrite) {
    return lines.join("\n");
  }

  return [
    ...lines,
    "",
    "Use memory tools only for stable user preferences or facts that will help in future chats.",
    "Do not save one-off requests, secrets, credentials, payment data, or sensitive health, legal, or financial facts unless the user explicitly asks you to remember them.",
    "When updating or removing an existing memory, use the memory id shown above.",
  ].join("\n");
}

export function createMemoryTools(input: {
  conversationId: string;
  memoryRepository: MemoryRepository;
  onEvent?: (event: MemoryEvent) => void;
  sourceMessageId: string;
}) {
  const createEvent = (
    event: Omit<MemoryEvent, "createdAt" | "id">,
  ): MemoryEvent => ({
    ...event,
    id: Crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });

  const tools = {
    rememberMemory: tool({
      description:
        "Save a stable user preference or fact for future chats. Do not save secrets, credentials, payment data, or sensitive health/legal/financial facts unless the user explicitly asks you to remember them.",
      inputSchema: z.object({
        content: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async ({ content, reason }) => {
        const memory = await input.memoryRepository.create({
          content: content.trim(),
          sourceConversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
        });
        const event = createEvent({
          kind: "created",
          memoryId: memory.id,
          content: memory.content,
          previousContent: null,
          reason: reason?.trim() || null,
        });

        input.onEvent?.(event);

        return {
          memoryId: memory.id,
          status: "saved",
        };
      },
    }),
    updateMemory: tool({
      description:
        "Update an existing memory by id when the new information replaces or clarifies the old memory.",
      inputSchema: z.object({
        memoryId: z.string().min(1),
        content: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async ({ content, memoryId, reason }) => {
        const current = await input.memoryRepository.getById(memoryId);

        if (!current || current.archivedAt) {
          return {
            memoryId,
            status: "not_found",
          };
        }

        const nextContent = content.trim();

        await input.memoryRepository.update(memoryId, {
          content: nextContent,
          enabled: true,
          sourceConversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
        });

        const event = createEvent({
          kind: "updated",
          memoryId,
          content: nextContent,
          previousContent: current.content,
          reason: reason?.trim() || null,
        });

        input.onEvent?.(event);

        return {
          memoryId,
          status: "updated",
        };
      },
    }),
    forgetMemory: tool({
      description:
        "Remove an existing memory by id when the user asks you to forget it or it is no longer true.",
      inputSchema: z.object({
        memoryId: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async ({ memoryId, reason }) => {
        const current = await input.memoryRepository.getById(memoryId);

        if (!current || current.archivedAt) {
          return {
            memoryId,
            status: "not_found",
          };
        }

        await input.memoryRepository.archive(memoryId);

        const event = createEvent({
          kind: "deleted",
          memoryId,
          content: current.content,
          previousContent: current.content,
          reason: reason?.trim() || null,
        });

        input.onEvent?.(event);

        return {
          memoryId,
          status: "removed",
        };
      },
    }),
  } satisfies ToolSet;

  return { tools };
}
