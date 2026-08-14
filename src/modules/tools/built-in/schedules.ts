import { tool } from "ai";
import { z } from "zod";

import type { Repositories } from "@/core/db/repositories/types";
import { parseModelRef } from "@/core/types/app-state";
import type { ToolExecutionRecord } from "@/core/types/app-state";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import { buildScheduleExpression } from "@/modules/scheduler/build-expression";
import { describeExpression, getLocalTimeZone } from "@/modules/scheduler/cron";

const SCHEDULE_FREQUENCIES = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "custom",
] as const;

function serializeSchedule(schedule: {
  autoApprove: boolean;
  enabled: boolean;
  expression: string;
  externalFolderSession?: { displayName: string } | null;
  id: string;
  nextRunAt: string | null;
  prompt: string;
  timezone: string;
  title: string;
}) {
  return {
    autoApprove: schedule.autoApprove,
    enabled: schedule.enabled,
    expression: schedule.expression,
    id: schedule.id,
    nextRunAt: schedule.nextRunAt
      ? new Date(schedule.nextRunAt).toISOString()
      : null,
    prompt: schedule.prompt,
    schedule: describeExpression(schedule.expression),
    targetFolder: schedule.externalFolderSession?.displayName ?? null,
    timezone: schedule.timezone,
    title: schedule.title,
  };
}

function toCronInput(input: {
  customExpression?: string;
  dayOfMonth?: number;
  frequency: string;
  time?: string;
  weekdays?: string[];
}) {
  return buildScheduleExpression({
    customExpression: input.customExpression,
    dayOfMonth: input.dayOfMonth,
    frequency: input.frequency as "custom" | "daily" | "hourly" | "monthly" | "weekly",
    time: input.time,
    weekdays: input.weekdays,
  });
}

export function createScheduleTools(input: {
  onRecord?: (record: ToolExecutionRecord) => void;
  refreshScheduler?: () => void;
  repositories: Repositories;
}) {
  const { repositories } = input;

  const handleRecord = (record: ToolExecutionRecord) => {
    input.onRecord?.(record);
  };

  return {
    tools: {
      schedule_task: tool({
        description:
          "Create a recurring job that the agent runs automatically on a schedule. The agent opens a dedicated conversation for the job and executes the prompt there on each occurrence. Runs autonomously (autoApprove) unless the job is created with autoApprove: false. Use natural-language scheduling: for 'every day at 9am' use frequency=daily with time=09:00; for 'every weekday at 8pm' use frequency=weekly with weekdays [Monday..Friday] and time=20:00.",
        inputSchema: z.object({
          autoApprove: z
            .boolean()
            .optional()
            .describe(
              "Whether the scheduled run approves its own tool calls. Defaults to true.",
            ),
          customExpression: z
            .string()
            .optional()
            .describe(
              "5-part cron expression (minute hour day-of-month month day-of-week) for frequency=custom. Example: '30 6 * * 1-5'.",
            ),
          dayOfMonth: z
            .number()
            .int()
            .min(1)
            .max(31)
            .optional()
            .describe("Day of month (1-31) for frequency=monthly."),
          frequency: z.enum(SCHEDULE_FREQUENCIES),
          prompt: z
            .string()
            .trim()
            .min(1)
            .describe(
              "Instruction the agent runs on every occurrence of the schedule.",
            ),
          time: z
            .string()
            .optional()
            .describe(
              "24-hour time as 'HH:MM' for daily, weekly, and monthly frequencies.",
            ),
          title: z.string().trim().min(1).max(120),
          weekdays: z
            .array(z.string())
            .optional()
            .describe(
              "Weekdays for frequency=weekly. Use names (Monday, Tuesday) or numbers 0-6 where 0=Sunday.",
            ),
        }),
        execute: async (args) => {
          const expression = toCronInput(args);
          const timezone = getLocalTimeZone();

          const { providerId, modelId } = await resolveScheduleTarget(
            repositories,
          );

          const schedule = await repositories.scheduleRepository.create({
            autoApprove: args.autoApprove ?? true,
            expression,
            modelId,
            prompt: args.prompt,
            providerId,
            timezone,
            title: args.title,
          });

          input.refreshScheduler?.();

          const result = serializeSchedule(schedule);
          handleRecord(
            createRecord({
              toolName: "schedule_task",
              status: "completed",
              inputSummary: summarizeValue({ title: args.title, frequency: args.frequency }),
              outputSummary: summarizeValue(result),
            }),
          );

          return result;
        },
      }),
      list_schedules: tool({
        description:
          "List every recurring job with its cron expression, enabled state, and next run time.",
        inputSchema: z.object({}),
        execute: async () => {
          const schedules = await repositories.scheduleRepository.list();

          const result = schedules.map((schedule) => ({
            autoApprove: schedule.autoApprove,
            enabled: schedule.enabled,
            expression: schedule.expression,
            id: schedule.id,
            lastRunAt: schedule.lastRunAt,
            nextRunAt: schedule.nextRunAt,
            prompt: schedule.prompt,
            schedule: describeExpression(schedule.expression),
            targetFolder: schedule.externalFolderSession?.displayName ?? null,
            title: schedule.title,
          }));

          handleRecord(
            createRecord({
              toolName: "list_schedules",
              status: "completed",
              inputSummary: summarizeValue({}),
              outputSummary: summarizeValue({ count: result.length }),
            }),
          );

          return { count: result.length, schedules: result };
        },
      }),
      update_schedule: tool({
        description:
          "Change an existing job: toggle enabled/autoApprove, edit the prompt, or reschedule it (frequency, time, weekdays, dayOfMonth, or customExpression).",
        inputSchema: z.object({
          autoApprove: z.boolean().optional(),
          customExpression: z.string().optional(),
          dayOfMonth: z.number().int().min(1).max(31).optional(),
          enabled: z.boolean().optional(),
          frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
          id: z.string(),
          prompt: z.string().trim().min(1).optional(),
          time: z.string().optional(),
          title: z.string().trim().min(1).max(120).optional(),
          weekdays: z.array(z.string()).optional(),
        }),
        execute: async (args) => {
          const { id, ...changes } = args;
          const current = await repositories.scheduleRepository.getById(id);

          if (!current) {
            throw new Error(`No job found with id "${id}".`);
          }

          const rescheduling = args.frequency !== undefined;
          const expression = rescheduling
            ? toCronInput(changes as Parameters<typeof toCronInput>[0])
            : undefined;

          await repositories.scheduleRepository.update(id, {
            autoApprove: args.autoApprove,
            enabled: args.enabled,
            expression,
            prompt: args.prompt,
            title: args.title,
          });

          const next = await repositories.scheduleRepository.getById(id);

          if (!next) {
            throw new Error(`Job "${id}" no longer exists.`);
          }

          input.refreshScheduler?.();

          const result = serializeSchedule(next);
          handleRecord(
            createRecord({
              toolName: "update_schedule",
              status: "completed",
              inputSummary: summarizeValue({ id, ...changes }),
              outputSummary: summarizeValue(result),
            }),
          );

          return result;
        },
      }),
      cancel_schedule: tool({
        description:
          "Delete a recurring job so it never runs again. Any in-flight run is unaffected.",
        inputSchema: z.object({
          id: z.string(),
        }),
        execute: async ({ id }) => {
          const current = await repositories.scheduleRepository.getById(id);

          if (!current) {
            throw new Error(`No job found with id "${id}".`);
          }

          await repositories.scheduleRepository.delete(id);
          input.refreshScheduler?.();

          handleRecord(
            createRecord({
              toolName: "cancel_schedule",
              status: "completed",
              inputSummary: summarizeValue({ id, title: current.title }),
              outputSummary: summarizeValue({ id, canceled: true }),
            }),
          );

          return { canceled: true, id, title: current.title };
        },
      }),
    },
  };
}

async function resolveScheduleTarget(repositories: Repositories) {
  const providers = await repositories.configRepository.listProviderConfigs();
  const enabledProviders = providers.filter((provider) => provider.enabled);

  if (enabledProviders.length === 0) {
    throw new Error(
      "No enabled provider is configured. Set up a model provider before scheduling jobs.",
    );
  }

  const settings = await repositories.configRepository.getSettings();

  if (settings.activeModelRef) {
    const { providerId, modelId } = parseModelRef(settings.activeModelRef);
    const providerActive = enabledProviders.some(
      (provider) => provider.id === providerId,
    );

    if (providerActive) {
      return { providerId, modelId };
    }
  }

  const provider = enabledProviders[0];
  const presets = await repositories.configRepository.listModelPresets();
  const defaultPreset = presets.find(
    (preset) => preset.providerId === provider.id && preset.isDefault,
  );
  const modelId = defaultPreset?.modelId ?? (presets[0]?.modelId ?? provider.id);

  return { providerId: provider.id, modelId };
}
