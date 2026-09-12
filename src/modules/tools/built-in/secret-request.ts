import { tool } from "ai";
import { z } from "zod";

import type { Repositories } from "@/core/db/repositories/types";
import type {
  PendingSecretRequestAnswer,
  PendingSecretRequestRequest,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

let secretRequestSequence = 0;

export function createSecretRequestTools(input: {
  onRecord?: (record: ToolExecutionRecord) => void;
  repositories: Repositories;
  requestSecret: (
    request: PendingSecretRequestRequest,
  ) => Promise<PendingSecretRequestAnswer>;
}) {
  const { onRecord, repositories, requestSecret } = input;
  const pluginRepository = repositories.pluginRepository;

  return {
    tools: {
      requestSecret: tool({
        description:
          "Pause and ask the user to type a secret value (API key, token, password) that a plugin needs. Pass the plugin id (as returned by listPlugins) and the exact key name the plugin's execute body reads via api.secrets.get(\"KEY\"). The user enters the value into a masked, on-device prompt that is stored encrypted and NEVER shown to you — you only receive whether it was stored or deferred. Call this only when a secret is genuinely required and missing (e.g. listPlugins reports requiredSecrets with hasAllSecrets false); do NOT ask the user to paste secrets into the chat. If the user defers, continue without the secret and let them know it is still missing — do not repeat the request.",
        inputSchema: z.object({
          scope: z
            .enum(["plugin"])
            .optional()
            .describe("Secret namespace. Only \"plugin\" is supported."),
          pluginId: z
            .string()
            .trim()
            .min(1)
            .max(128)
            .describe("The id of the plugin that needs the secret."),
          key: z
            .string()
            .trim()
            .min(1)
            .max(128)
            .regex(
              /^[A-Za-z0-9._-]+$/,
              "Key names may only contain letters, numbers, dots, underscores, and dashes.",
            )
            .describe(
              "The exact secret key name the plugin reads (e.g. MY_API_KEY).",
            ),
          purpose: z
            .string()
            .trim()
            .max(300)
            .optional()
            .describe(
              "A short, non-sensitive explanation of what the secret is used for, shown to the user.",
            ),
        }),
        execute: async (args) => {
          const inputSummary = summarizeValue({
            pluginId: args.pluginId,
            key: args.key,
          });

          try {
            const plugin = await pluginRepository.getById(args.pluginId);

            if (!plugin) {
              const message = `No plugin with id "${args.pluginId}" exists. Call listPlugins to see the installed plugin ids first.`;

              onRecord?.(
                createRecord({
                  toolName: "requestSecret",
                  status: "failed",
                  inputSummary,
                  error: message,
                }),
              );

              return { status: "error", key: args.key, message };
            }

            secretRequestSequence += 1;
            const request: PendingSecretRequestRequest = {
              id: `secret:${Date.now()}:${secretRequestSequence}`,
              scope: "plugin",
              pluginId: args.pluginId,
              key: args.key,
              purpose: args.purpose ?? null,
            };
            const answer = await requestSecret(request);
            const status = answer.status;

            onRecord?.(
              createRecord({
                toolName: "requestSecret",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ status }),
              }),
            );

            return { status, key: args.key };
          } catch (error) {
            onRecord?.(
              createRecord({
                toolName: "requestSecret",
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