import { tool } from "ai";
import { z } from "zod";

import type {
  AgentConfig,
  ResolvedModel,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import { listSubagents } from "@/modules/agents/registry";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

export type SubagentTaskResult = {
  conversationId?: string;
  output: string;
};

export function describeModelCatalog(models: ResolvedModel[]) {
  if (models.length === 0) return "Available models: none.";
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const group = groups.get(model.providerLabel) ?? [];
    group.push(`- ${model.ref} (${model.label})`);
    groups.set(model.providerLabel, group);
  }
  return `Available models (pass the full ref as "model"):\n${[...groups]
    .map(([provider, entries]) => `${provider}:\n${entries.join("\n")}`)
    .join("\n")}`;
}

export function describeSubagentCatalog(
  agents: AgentConfig[],
  models: ResolvedModel[] = [],
) {
  const subagents = listSubagents(agents).map((agent) => ({
    description: agent.description ?? "",
    name: agent.name,
  }));

  if (subagents.length === 0) {
    return "No subagents are configured yet. Tell the user they can create subagents in Settings > Agents (availability: Subagent only or Chat + Subagent).";
  }

  return `Available subagents:\n${subagents
    .map(
      (agent) => `- ${agent.name}: ${agent.description || "(no description)"}`,
    )
    .join("\n")}\n\n${describeModelCatalog(models)}`;
}

export function createTaskTool(input: {
  getAgents: () => AgentConfig[];
  getModels?: () => ResolvedModel[];
  onRecord?: (record: ToolExecutionRecord) => void;
  spawnSubagent: (task: {
    abortSignal?: AbortSignal;
    agentName: string;
    description: string;
    model?: string | null;
    prompt: string;
  }) => Promise<SubagentTaskResult>;
}) {
  const { getAgents, getModels = () => [], spawnSubagent } = input;

  return {
    tools: {
      task: tool({
        description:
          `Delegate a task to a specialized subagent and wait for its result. Use this when a subagent's specialty matches part of the current work, or to research complex questions and execute multi-step units of work in isolation. Provide a short description, the target subagent_type, and the full prompt for the subagent. Set "model" to the full ref of any model the subagent should use; omit it to inherit the current model. The subagent cannot see this conversation; include everything it needs in the prompt. Its final response is returned to you.\n\n${describeModelCatalog(getModels())}`,
        inputSchema: z.object({
          description: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("A short (3-5 words) description of the task"),
          model: z
            .string()
            .trim()
            .min(1)
            .max(256)
            .optional()
            .describe(
              "Optional full model ref (provider/model) for the subagent. Omit to use the current model.",
            ),
          prompt: z
            .string()
            .trim()
            .min(1)
            .max(100_000)
            .describe("The complete task for the subagent to perform"),
          subagent_type: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .describe("The name of the subagent to use for this task"),
        }),
        execute: async ({ description, model, prompt, subagent_type }, options) => {
          const available = listSubagents(getAgents()).find(
            (agent) =>
              agent.name === subagent_type || agent.id === subagent_type,
          );

          if (!available) {
            return {
              ok: false,
              error: `Unknown subagent "${subagent_type}". ${describeSubagentCatalog(getAgents(), getModels())}`,
            };
          }

          const executionId = `task:${options.toolCallId}`;
          const subagent = {
            agentName: available.name,
            conversationId: null,
            description,
          };
          input.onRecord?.(
            createRecord({
              id: executionId,
              toolName: "task",
              status: "running",
              inputSummary: summarizeValue({
                agent: available.name,
                description,
              }),
              subagent,
            }),
          );

          try {
            const result = await spawnSubagent({
              abortSignal: options.abortSignal,
              agentName: available.name,
              description,
              model,
              prompt,
            });

            input.onRecord?.(
              createRecord({
                id: executionId,
                toolName: "task",
                status: "completed",
                inputSummary: summarizeValue({
                  agent: available.name,
                  description,
                }),
                outputSummary: null,
                subagent: {
                  ...subagent,
                  conversationId: result.conversationId ?? null,
                },
              }),
            );

            return {
              ok: true,
              agent: available.name,
              conversationId: result.conversationId ?? null,
              result: result.output,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);

            input.onRecord?.(
              createRecord({
                id: executionId,
                toolName: "task",
                status: "failed",
                inputSummary: summarizeValue({
                  agent: available.name,
                  description,
                }),
                outputSummary: null,
                error: message,
                subagent,
              }),
            );

            return {
              ok: false,
              agent: available.name,
              error: `Subagent failed: ${message}`,
            };
          }
        },
      }),
    },
  };
}
