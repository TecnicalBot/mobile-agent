import { tool } from "ai";
import { z } from "zod";

import type { Repositories } from "@/core/db/repositories/types";
import { secureSecretStore } from "@/core/services/secrets";
import type { ToolExecutionRecord } from "@/core/types/app-state";
import { buildPluginSource, validatePluginSource } from "@/modules/plugins/builder";
import { importPluginSource } from "@/modules/plugins/import";
import { manifestToId } from "@/modules/plugins/manifest";
import { extractRequiredSecretKeys } from "@/modules/plugins/secret-keys";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_AUTHOR_LENGTH = 64;
const MAX_VERSION_LENGTH = 32;
const MAX_TOOLS_PER_PLUGIN = 20;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOL_DESCRIPTION_LENGTH = 1024;
const MAX_EXECUTE_BODY_LENGTH = 4000;
const MAX_SYSTEM_PARTS = 8;
const MAX_SYSTEM_PART_LENGTH = 2000;

const toolSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TOOL_NAME_LENGTH)
    .regex(/^[a-zA-Z0-9_]+$/)
    .describe(
      "Tool name — letters, numbers, and underscores only, no spaces.",
    ),
  description: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TOOL_DESCRIPTION_LENGTH)
    .describe("When and how the agent should use this tool."),
  inputSchema: z
    .record(z.string(), z.unknown())
    .describe(
      "A valid JSON Schema object for the tool arguments, e.g. { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }.",
    ),
  mutating: z
    .boolean()
    .optional()
    .describe(
      "Whether this tool changes state (sends, writes, deletes). Defaults to false. Mutating tools require user approval before running.",
    ),
  executeBody: z
    .string()
    .trim()
    .min(1)
    .max(MAX_EXECUTE_BODY_LENGTH)
    .describe(
      "A self-contained JavaScript function body. `args` is the tool input object; `api.fetch(url, init)`, `api.storage.get/set/delete(key)`, `api.secrets.get/set/delete(key)`, and `api.log(...)` are available. No imports, no require(). Return a JSON-serializable value or string.",
    ),
});

function buildPluginId(name: string) {
  return manifestToId({ name, version: "0.0.0" });
}

function missingSecrets(required: string[], configured: string[]): string[] {
  return required.filter((key) => !configured.includes(key));
}

export function createPluginTools(input: {
  onPluginsChange?: () => void;
  onRecord?: (record: ToolExecutionRecord) => void;
  repositories: Repositories;
}) {
  const { onPluginsChange, onRecord, repositories } = input;
  const pluginRepository = repositories.pluginRepository;

  return {
    tools: {
      managePlugin: tool({
        description:
          "Create, update, delete, or list plugins. Plugins are installable capabilities that add tools (and optional system-prompt instructions) the agent can use across conversations. Use createPlugin when the user asks to add a reusable capability (checking weather, querying an API, syncing two services); use updatePlugin to modify an existing plugin; use deletePlugin to remove one; use listPlugins to show installed plugins. Each plugin tool has a name, a description, a JSON Schema inputSchema, and an execute body — a single self-contained JavaScript function body. Inside the body, `args` is the tool input and `api.fetch/storage/secrets/log` are available; do NOT use imports or require(). Mutating tools (ones that send/write/delete) must set mutating: true so the user approves them. If a tool needs an API key or token, reference it only by key name inside the execute body via `await api.secrets.get(\"MY_API_KEY\")` where MY_API_KEY is a descriptive UPPER_SNAKE key. NEVER ask the user to paste a secret value into the chat and NEVER guess or echo a stored value. After creating a plugin, report any returned secretsMissing keys so the user knows what to configure — you may also collect a missing secret in-chat by calling the requestSecret tool with the plugin id (from listPlugins) and the key name; the user types the value into a masked, encrypted on-device prompt that you never see. If the user defers, continue without the secret.",
        inputSchema: z
          .object({
            action: z.enum([
              "createPlugin",
              "updatePlugin",
              "deletePlugin",
              "listPlugins",
            ]),
            name: z
              .string()
              .trim()
              .min(1)
              .max(MAX_NAME_LENGTH)
              .optional()
              .describe("Plugin name (kebab-case recommended)."),
            version: z
              .string()
              .trim()
              .min(1)
              .max(MAX_VERSION_LENGTH)
              .optional()
              .describe("Semver version (defaults to 1.0.0)."),
            description: z
              .string()
              .trim()
              .min(1)
              .max(MAX_DESCRIPTION_LENGTH)
              .optional()
              .describe("Short description of the plugin."),
            author: z
              .string()
              .trim()
              .min(1)
              .max(MAX_AUTHOR_LENGTH)
              .optional()
              .describe("Plugin author (optional)."),
            tools: z
              .array(toolSchema)
              .max(MAX_TOOLS_PER_PLUGIN)
              .optional()
              .describe("Tools the plugin provides to the agent."),
            system: z
              .array(z.string().trim().min(1).max(MAX_SYSTEM_PART_LENGTH))
              .max(MAX_SYSTEM_PARTS)
              .optional()
              .describe(
                "Optional extra system-prompt instructions injected whenever the plugin is active.",
              ),
          })
          .refine(
            (value) => value.action === "listPlugins" || Boolean(value.name),
            { message: "name is required unless action is listPlugins." },
          )
          .refine(
            (value) =>
              value.action !== "createPlugin" ||
              Boolean(value.tools?.length) ||
              Boolean(value.system?.length),
            {
              message:
                "createPlugin needs at least one tool or a system section.",
            },
          ),
        execute: async (args) => {
          const inputSummary = summarizeValue(args);

          if (args.action === "listPlugins") {
            const plugins = await pluginRepository.list();
            const catalog = await Promise.all(
              plugins.map(async (plugin) => {
                const configured =
                  await secureSecretStore.listPluginSecretKeys(plugin.id);
                return {
                  id: plugin.id,
                  name: plugin.name,
                  version: plugin.version,
                  description: plugin.description,
                  enabled: plugin.enabled,
                  autoUpdates: Boolean(plugin.sourceUrl),
                  requiredSecrets: plugin.requiredSecrets,
                  hasAllSecrets: missingSecrets(
                    plugin.requiredSecrets,
                    configured,
                  ).length === 0,
                };
              }),
            );

            onRecord?.(
              createRecord({
                toolName: "managePlugin",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ count: catalog.length }),
              }),
            );

            return { count: catalog.length, plugins: catalog };
          }

          if (args.action === "deletePlugin") {
            const id = buildPluginId(args.name as string);
            const existing = await pluginRepository.getById(id);

            if (!existing) {
              return {
                deleted: false,
                message: `No plugin named "${args.name}" exists.`,
              };
            }

            await pluginRepository.delete(id);
            onPluginsChange?.();

            onRecord?.(
              createRecord({
                toolName: "managePlugin",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ deleted: existing.name }),
              }),
            );

            return { deleted: true, name: existing.name };
          }

          const name = (args.name as string).trim();
          const tools = args.tools ?? [];
          const system = args.system ?? [];
          const version = args.version?.trim() || "1.0.0";
          const id = buildPluginId(name);
          const existing = await pluginRepository.getById(id);

          if (args.action === "createPlugin" && existing) {
            return {
              created: false,
              message: `A plugin named "${existing.name}" already exists. Use the updatePlugin action to modify it.`,
            };
          }

          if (args.action === "updatePlugin" && !existing) {
            return {
              updated: false,
              message: `No plugin named "${name}" exists. Use the createPlugin action to add it first.`,
            };
          }

          const source = buildPluginSource({
            name,
            version,
            description: args.description?.trim(),
            author: args.author?.trim(),
            tools,
            system,
          });

          const validation = await validatePluginSource(source);
          if (!validation.ok) {
            return {
              created: false,
              updated: false,
              error:
                `The generated plugin failed to load: ${validation.error}. ` +
                "Fix the execute bodies (valid JavaScript, no imports) and try again.",
            };
          }

          const requiredSecrets = extractRequiredSecretKeys(source);

          const result = await importPluginSource(source, repositories);
          if (!result.ok) {
            return { created: false, updated: false, error: result.error };
          }

          const configured = await secureSecretStore.listPluginSecretKeys(
            result.plugin.id,
          );
          const secretsMissing = missingSecrets(requiredSecrets, configured);

          onPluginsChange?.();

          onRecord?.(
            createRecord({
              toolName: "managePlugin",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue({
                name: result.plugin.name,
                version: result.plugin.version,
                wasUpdate: result.wasUpdate,
                tools: validation.toolCount,
                requiredSecrets,
                secretsMissing,
              }),
            }),
          );

          return {
            created: !result.wasUpdate,
            updated: result.wasUpdate,
            id: result.plugin.id,
            name: result.plugin.name,
            version: result.plugin.version,
            description: result.plugin.description,
            toolCount: validation.toolCount,
            requiredSecrets,
            secretsMissing,
            message: secretsMissing.length > 0
              ? `Configure the plugin's secret${secretsMissing.length > 1 ? "s" : ""} ${secretsMissing.map((key) => `"${key}"`).join(", ")} in Settings → Plugins → ${result.plugin.name} → Secrets. Do not ask the user to paste secret values into the chat.`
              : undefined,
          };
        },
      }),
    },
  };
}