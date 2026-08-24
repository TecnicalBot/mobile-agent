import { tool } from "ai";
import { z } from "zod";

import type {
  AgentConfig,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

export type SubagentTaskResult = {
  output: string;
};

export function describeSubagentCatalog(agents: AgentConfig[]) {
  const subagents = agents
    .filter((agent) => agent.enabled && agent.mode !== "primary")
    .map((agent) => ({
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
    .join("\n")}`;
}

export function createTaskTool(input: {
  getAgents: () => AgentConfig[];
  onRecord?: (record: ToolExecutionRecord) => void;
  spawnSubagent: (task: {
    abortSignal?: AbortSignal;
    agentName: string;
    description: string;
    prompt: string;
  }) => Promise<SubagentTaskResult>;
}) {
  const { getAgents, spawnSubagent } = input;

  return {
    tools: {
      task: tool({
        description:
          "Delegate a task to a specialized subagent and wait for its result. Use this when a subagent's specialty matches part of the current work, or to research complex questions and execute multi-step units of work in isolation. Provide a short description, the target subagent_type, and the full prompt for the subagent. The subagent cannot see this conversation; include everything it needs in the prompt. Its final response is returned to you.",
        inputSchema: z.object({
          description: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("A short (3-5 words) description of the task"),
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
        execute: async ({ description, prompt, subagent_type }, options) => {
          const available = getAgents().find(
            (agent) =>
              agent.enabled &&
              agent.mode !== "primary" &&
              (agent.name === subagent_type || agent.id === subagent_type),
          );

          if (!available) {
            return {
              ok: false,
              error: `Unknown subagent "${subagent_type}". ${describeSubagentCatalog(getAgents())}`,
            };
          }

          try {
            const result = await spawnSubagent({
              abortSignal: options.abortSignal,
              agentName: available.name,
              description,
              prompt,
            });

            input.onRecord?.(
              createRecord({
                toolName: "task",
                status: "completed",
                inputSummary: summarizeValue({
                  agent: available.name,
                  description,
                }),
                outputSummary: summarizeValue({
                  chars: result.output.length,
                }),
              }),
            );

            return {
              ok: true,
              agent: available.name,
              result: result.output,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);

            input.onRecord?.(
              createRecord({
                toolName: "task",
                status: "failed",
                inputSummary: summarizeValue({
                  agent: available.name,
                  description,
                }),
                outputSummary: null,
                error: message,
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
