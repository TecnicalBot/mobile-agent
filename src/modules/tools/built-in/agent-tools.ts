import { tool } from "ai";
import { z } from "zod";

import type { AgentRepository } from "@/core/db/repositories/types";
import type {
  AgentConfig,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import {
  normalizeAgentName,
  serializeAgentToMarkdown,
} from "@/modules/agents/agent-markdown";
import { NATIVE_AGENTS } from "@/modules/agents/registry";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_PROMPT_LENGTH = 40_000;

const modeSchema = z.enum(["all", "primary", "subagent"]);

function formatAgentForCatalog(agent: AgentConfig) {
  return {
    description: agent.description?.trim() || null,
    mode: agent.mode,
    model:
      agent.modelProviderId && agent.modelModelId
        ? `${agent.modelProviderId}/${agent.modelModelId}`
        : null,
    name: agent.name,
  };
}

export function createAgentTools(input: {
  onRecord?: (record: ToolExecutionRecord) => void;
  onAgentsChange?: () => void;
  repository: AgentRepository;
}) {
  const { onRecord, onAgentsChange, repository } = input;

  return {
    tools: {
      manageAgent: tool({
        description:
          "Create, update, delete, or list custom agents. An agent is a reusable persona: a kebab-case name, a description of when to use it, an availability mode (primary agents are selectable in chats; subagents are invoked via the task tool; 'all' means both), and a markdown system prompt that replaces the default persona while the agent runs. Use createAgent when the user asks to add or save an agent.",
        inputSchema: z
          .object({
            action: z.enum([
              "createAgent",
              "updateAgent",
              "deleteAgent",
              "listAgents",
            ]),
            name: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .optional()
              .describe("Agent name (kebab-case recommended)."),
            description: z
              .string()
              .trim()
              .max(MAX_DESCRIPTION_LENGTH)
              .optional()
              .describe("When and why to use this agent."),
            mode: modeSchema.optional().describe(
              "'primary' = selectable in chats, 'subagent' = only invokable via task tool, 'all' = both. Defaults to 'all'.",
            ),
            prompt: z
              .string()
              .trim()
              .min(1)
              .max(MAX_PROMPT_LENGTH)
              .optional()
              .describe(
                "The markdown system prompt replacing the default persona while this agent runs.",
              ),
            model: z
              .string()
              .trim()
              .regex(/^[^/]+\/[^/].*$/)
              .max(200)
              .optional()
              .describe(
                "Optional model override as provider/model (e.g. anthropic/claude-sonnet-4). Empty uses the chat's current model.",
              ),
            temperature: z
              .number()
              .min(0)
              .max(2)
              .optional()
              .describe("Optional sampling temperature override."),
          })
          .refine((value) => value.action === "listAgents" || Boolean(value.name), {
            message: "name is required unless action is listAgents.",
          })
          .refine(
            (value) =>
              value.action !== "createAgent" ||
              Boolean(value.prompt) ||
              value.mode === undefined,
            { message: "prompt is required when creating an agent." },
          ),
        execute: async (args) => {
          const inputSummary = summarizeValue(args);

          if (args.action === "listAgents") {
            const [stored] = await Promise.all([repository.list()]);
            const catalog = [
              ...NATIVE_AGENTS.map(formatAgentForCatalog),
              ...stored
                .filter((agent) => agent.enabled)
                .map(formatAgentForCatalog),
            ];

            onRecord?.(
              createRecord({
                toolName: "manageAgent",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({
                  agents: catalog,
                  count: catalog.length,
                }),
              }),
            );

            return {
              agents: catalog,
              count: catalog.length,
            };
          }

          const name =
            normalizeAgentName(args.name ?? "") || (args.name ?? "").trim();

          if (
            args.action !== "deleteAgent" &&
            NATIVE_AGENTS.some((native) => native.name === name)
          ) {
            return {
              ok: false,
              message: `"${name}" is reserved by a built-in agent. Pick another name.`,
            };
          }

          if (args.action === "deleteAgent") {
            const stored = await repository.list();
            const existing = stored.find(
              (agent) => agent.name.toLowerCase() === name.toLowerCase(),
            );

            if (!existing) {
              return {
                deleted: false,
                message: `No agent named "${args.name}" exists.`,
              };
            }

            await repository.delete(existing.id);
            onAgentsChange?.();

            onRecord?.(
              createRecord({
                toolName: "manageAgent",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ deleted: existing.name }),
              }),
            );

            return {
              deleted: true,
              name: existing.name,
            };
          }

          let modelProviderId: string | null | undefined;
          let modelModelId: string | null | undefined;

          if (args.model !== undefined) {
            if (args.model === "") {
              modelProviderId = null;
              modelModelId = null;
            } else {
              const separatorIndex = args.model.indexOf("/");

              if (separatorIndex <= 0) {
                return {
                  ok: false,
                  message:
                    "Model must look like provider/model (e.g. anthropic/claude-sonnet-4).",
                };
              }

              modelProviderId = args.model.slice(0, separatorIndex);
              modelModelId = args.model.slice(separatorIndex + 1);
            }
          }

          if (args.action === "createAgent") {
            const stored = await repository.list();
            const existing = stored.find(
              (agent) => agent.name.toLowerCase() === name.toLowerCase(),
            );

            if (existing) {
              return {
                created: false,
                message: `An agent named "${existing.name}" already exists. Use the updateAgent action to modify it instead.`,
              };
            }

            const agent = await repository.create({
              description: args.description?.trim() ?? null,
              mode: args.mode ?? "all",
              ...(modelModelId !== undefined ? { modelModelId } : {}),
              ...(modelProviderId !== undefined ? { modelProviderId } : {}),
              name,
              prompt: (args.prompt as string).trim(),
              temperature: args.temperature ?? null,
            });

            onAgentsChange?.();

            onRecord?.(
              createRecord({
                toolName: "manageAgent",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ created: agent.name }),
              }),
            );

            return {
              created: true,
              id: agent.id,
              markdown: serializeAgentToMarkdown(agent),
              name: agent.name,
            };
          }

          const stored = await repository.list();
          const existing = stored.find(
            (agent) => agent.name.toLowerCase() === name.toLowerCase(),
          );

          if (!existing) {
            return {
              updated: false,
              message: `No agent named "${name}" exists. Use the createAgent action to add it first.`,
            };
          }

          await repository.update(existing.id, {
            description: args.description?.trim(),
            mode: args.mode,
            ...(modelModelId !== undefined ? { modelModelId } : {}),
            ...(modelProviderId !== undefined ? { modelProviderId } : {}),
            prompt: args.prompt?.trim(),
            temperature: args.temperature,
          });
          onAgentsChange?.();

          const next = await repository.getById(existing.id);

          onRecord?.(
            createRecord({
              toolName: "manageAgent",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue({
                updated: existing.name,
                sourceMarkdown: next
                  ? serializeAgentToMarkdown(next)
                  : null,
              }),
            }),
          );

          return {
            updated: true,
            id: existing.id,
            markdown: next ? serializeAgentToMarkdown(next) : null,
            name: existing.name,
          };
        },
      }),
    },
  };
}
