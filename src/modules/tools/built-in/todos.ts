import { tool } from "ai";
import * as Crypto from "expo-crypto";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { TodoListItem, ToolExecutionRecord } from "@/core/types/app-state";

const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
const MAX_TODOS = 25;
const MAX_TITLE_LENGTH = 200;

function mergeTodoList(
  current: TodoListItem[],
  next: { title: string; status: TodoListItem["status"] }[],
): TodoListItem[] {
  const byTitle = new Map(
    current.map((item) => [item.title.trim().toLowerCase(), item]),
  );
  const now = new Date().toISOString();
  const result: TodoListItem[] = [];

  for (const input of next) {
    const title = input.title.trim();

    if (!title) {
      continue;
    }

    const key = title.toLowerCase();
    const existing = byTitle.get(key);

    if (existing) {
      result.push({
        ...existing,
        status: input.status,
        completedAt:
          input.status === "completed"
            ? (existing.completedAt ?? now)
            : null,
      });
    } else {
      result.push({
        id: Crypto.randomUUID(),
        title,
        status: input.status,
        createdAt: now,
        completedAt: input.status === "completed" ? now : null,
      });
    }
  }

  return result;
}

export function createTodosTool(input: {
  getCurrentTodos: () => TodoListItem[];
  onRecord?: (record: ToolExecutionRecord) => void;
  onTodosChange?: (todos: TodoListItem[]) => void;
}) {
  return {
    tools: {
      todos: tool({
        description:
          "Replace the visible task list with the complete revised list of tasks for the current request. Use for multi-step work so the user can follow progress. Statuses: pending, in_progress, completed. Items are matched by title; re-send every task you want to keep with its current status.",
        inputSchema: z.object({
          todos: z
            .array(
              z.object({
                status: z.enum(TODO_STATUSES),
                title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
              }),
            )
            .min(1)
            .max(MAX_TODOS),
        }),
        execute: async ({ todos }) => {
          const inputSummary = summarizeValue({ count: todos.length });
          const next = mergeTodoList(input.getCurrentTodos(), todos);

          try {
            input.onTodosChange?.(next);

            input.onRecord?.(
              createRecord({
                toolName: "todos",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({
                  count: next.length,
                  items: next.map((item) => ({
                    status: item.status,
                    title: item.title,
                  })),
                }),
              }),
            );

            return {
              count: next.length,
              items: next.map((item) => ({
                status: item.status,
                title: item.title,
              })),
            };
          } catch (error) {
            input.onRecord?.(
              createRecord({
                toolName: "todos",
                status: "failed",
                inputSummary,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            throw error;
          }
        },
      }),
    },
  };
}
