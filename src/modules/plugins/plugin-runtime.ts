import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

import type { PluginConfig } from "@/core/types/app-state";

import { secureSecretStore } from "@/core/services/secrets";
import type {
  ProviderConfig,
  ResolvedModel,
} from "@/core/types/app-state";
import { modelRuntime } from "@/modules/runtime/model-runtime";
import type { PluginOutputRecord } from "@/core/types/app-state";
import { loadAllPlugins } from "./loader";
import {
  createTimeoutSignal,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "./plugin-timeout";
import type {
  LoadedPlugin,
  PluginActionInfo,
  PluginEventName,
  PluginHostContext,
  PluginKeyValueStore,
  PluginProgressUpdate,
  PluginRuntimeSnapshot,
  PluginToolResult,
} from "./types";

type PluginStorageRepository = {
  delete(pluginId: string, key: string): Promise<void>;
  get(pluginId: string, key: string): Promise<string | null>;
  set(pluginId: string, key: string, value: string): Promise<void>;
};

function createSecretStore(pluginId: string): PluginKeyValueStore {
  return {
    delete: (key) => secureSecretStore.deletePluginSecret(pluginId, key),
    get: (key) => secureSecretStore.getPluginSecret(pluginId, key),
    set: (key, value) => secureSecretStore.setPluginSecret(pluginId, key, value),
  };
}

function toolPrefix(pluginId: string) {
  return `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}_`;
}

export function createPluginRuntime(
  storage: PluginStorageRepository,
  getModelDefaults?: () => {
    model: ResolvedModel;
    provider: ProviderConfig;
  } | null,
) {
  let loaded: LoadedPlugin[] = [];

  const callStateByContext = new WeakMap<
    PluginHostContext,
    { setKind: (kind: "action" | "tool" | undefined) => void; setSignal: (signal: AbortSignal | undefined) => void }
  >();

  const createContext = (
    pluginId: string,
    options?: Record<string, unknown>,
  ): PluginHostContext => {
    let currentAbortSignal: AbortSignal | undefined;
    let currentCallKind: "action" | "tool" | undefined;
    const allowAiInTools = options?.allowAiInTools === true;

    const context: PluginHostContext = {
      ai: {
        async generate(options) {
          if (currentCallKind === "tool" && !allowAiInTools) {
            throw new Error(
              "api.ai is disabled for tools. Set options.allowAiInTools to true in the plugin's settings to enable it.",
            );
          }
          const defaults = getModelDefaults?.();
          if (!defaults) {
            throw new Error(
              "No active model is configured. Set one in Settings before using api.ai.",
            );
          }
          const result = await modelRuntime.generateTextStream({
            abortSignal: currentAbortSignal,
            maxToolSteps: 1,
            messages: [{ role: "user", content: options.prompt }],
            model: defaults.model,
            provider: defaults.provider,
            secretStore: secureSecretStore,
            system: options.system,
          });
          return result.text;
        },
      },
      emit(event, payload) {
        console.log(`[plugin:${pluginId}] ${event}`, payload);
      },
      fetch: (request, init) =>
        globalThis.fetch(request, {
          ...init,
          signal: init?.signal ?? currentAbortSignal,
        }),
      log: (...args) => console.log(`[plugin:${pluginId}]`, ...args),
      secrets: createSecretStore(pluginId),
      storage: {
        delete: (key) => storage.delete(pluginId, key),
        get: (key) => storage.get(pluginId, key),
        set: (key, value) => storage.set(pluginId, key, value),
      },
    };

    callStateByContext.set(context, {
      setKind: (kind) => {
        currentCallKind = kind;
      },
      setSignal: (signal) => {
        currentAbortSignal = signal;
      },
    });

    return context;
  };

  async function disposePlugins() {
    for (const plugin of loaded) {
      try {
        await plugin.hooks.dispose?.();
      } catch (error) {
        console.warn(`[plugin:${plugin.id}] dispose failed`, error);
      }
    }
    loaded = [];
  }

  return {
    async dispose() {
      await disposePlugins();
    },
    async load(configs: PluginConfig[]) {
      await disposePlugins();
      const result = await loadAllPlugins(configs, createContext);
      loaded = result.plugins;
      return result.errors;
    },
    snapshot(sessionId: string): PluginRuntimeSnapshot {
      const tools: ToolSet = {};
      const autoApprovedToolNames = new Set<string>();
      const systemParts: string[] = [];

      const pluginOutputs: PluginOutputRecord[] = [];
      const actions: PluginActionInfo[] = [];

      for (const plugin of loaded) {
        for (const [actionName, definition] of Object.entries(
          plugin.hooks.action ?? {},
        )) {
          actions.push({
            description: definition.description,
            inputSchema: definition.inputSchema,
            mutating: definition.mutating,
            name: actionName,
            pluginId: plugin.id,
            title: definition.title ?? actionName,
          });
        }

        const prefix = toolPrefix(plugin.id);
        for (const [name, definition] of Object.entries(plugin.hooks.tool ?? {})) {
          const runtimeName = `${prefix}${name}`;
          try {
            tools[runtimeName] = tool({
              description: definition.description,
              inputSchema: z.fromJSONSchema(definition.inputSchema),
              execute: async (args, context) => {
                const timeout = createTimeoutSignal(
                  definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
                  context.abortSignal,
                );
                if (plugin.context) {
                  callStateByContext.get(plugin.context)?.setSignal(timeout.signal);
                  callStateByContext.get(plugin.context)?.setKind("tool");
                }
                try {
                  let liveTitle: string | undefined;
                  let liveMetadata: Record<string, unknown> | undefined;
                  const liveRecord: PluginOutputRecord = {
                    output: "",
                    pluginId: plugin.id,
                    title: undefined,
                    toolName: name,
                  };
                  let liveRecordPushed = false;

                  const result = await definition.execute(
                    args as Record<string, unknown>,
                    {
                      abortSignal: timeout.signal,
                      metadata(update) {
                        liveTitle = update.title ?? liveTitle;
                        liveMetadata = update.metadata
                          ? { ...liveMetadata, ...update.metadata }
                          : liveMetadata;
                        liveRecord.title = liveTitle;
                        liveRecord.metadata = liveMetadata;
                        if (!liveRecordPushed) {
                          pluginOutputs.push(liveRecord);
                          liveRecordPushed = true;
                        }
                      },
                    },
                  );
                  const routing = definition.output ?? "model";
                  const outputText =
                    typeof result === "string" ? result : result.output;
                  const title =
                    typeof result === "string"
                      ? liveTitle
                      : (result.title ?? liveTitle);
                  const metadata =
                    typeof result === "string"
                      ? liveMetadata
                      : { ...liveMetadata, ...result.metadata };
                  const attachments =
                    typeof result === "string" ? undefined : result.attachments;

                  if (routing === "user" || routing === "both") {
                    if (liveRecordPushed) {
                      liveRecord.output = outputText;
                      liveRecord.title = title;
                      liveRecord.metadata = metadata;
                      liveRecord.attachments = attachments;
                    } else {
                      pluginOutputs.push({
                        attachments,
                        metadata,
                        output: outputText,
                        pluginId: plugin.id,
                        title,
                        toolName: name,
                      });
                    }
                  } else if (liveRecordPushed) {
                    const index = pluginOutputs.indexOf(liveRecord);
                    if (index >= 0) pluginOutputs.splice(index, 1);
                  }

                  switch (routing) {
                    case "user":
                      return title
                        ? `Result shown to the user (${title}).`
                        : "Result shown to the user.";
                    case "silent":
                      return "Action completed. Result hidden from the model.";
                    case "both":
                    case "model":
                    default:
                      return outputText;
                  }
                } finally {
                  if (plugin.context) {
                    callStateByContext.get(plugin.context)?.setSignal(undefined);
                    callStateByContext.get(plugin.context)?.setKind(undefined);
                  }
                  timeout.cancel();
                }
              },
            });
            if (!definition.mutating) autoApprovedToolNames.add(runtimeName);
          } catch (error) {
            console.warn(`[plugin:${plugin.id}] invalid tool ${name}`, error);
          }
        }

        try {
          const parts =
            typeof plugin.hooks.system === "function"
              ? plugin.hooks.system({ sessionId })
              : plugin.hooks.system;
          if (parts) systemParts.push(...parts.filter(Boolean));
        } catch (error) {
          console.warn(`[plugin:${plugin.id}] system hook failed`, error);
        }
      }

      return {
        actions,
        autoApprovedToolNames,
        async runAction(pluginId, name, args = {}, onProgress) {
          const plugin = loaded.find((item) => item.id === pluginId);
          const definition = plugin?.hooks.action?.[name];
          if (!plugin || !definition) {
            throw new Error(`Plugin action not found: ${pluginId}/${name}`);
          }
          const timeout = createTimeoutSignal(
            definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
          );
          if (plugin.context) {
            callStateByContext.get(plugin.context)?.setSignal(timeout.signal);
            callStateByContext.get(plugin.context)?.setKind("action");
          }
          try {
            return await definition.run(args, {
              abortSignal: timeout.signal,
              metadata: onProgress,
            });
          } finally {
            if (plugin.context) {
              callStateByContext.get(plugin.context)?.setSignal(undefined);
              callStateByContext.get(plugin.context)?.setKind(undefined);
            }
            timeout.cancel();
          }
        },
        async dispatch(event: PluginEventName, payload: unknown) {
          await Promise.allSettled(
            loaded.map(async (plugin) => {
              const handler = plugin.hooks.event?.[event];
              if (!handler) return;
              try {
                await handler(payload);
              } catch (error) {
                console.warn(`[plugin:${plugin.id}] ${event} hook failed`, error);
              }
            }),
          );
        },
        systemParts,
        tools,
        pluginOutputs,
      };
    },
  };
}

export type PluginRuntime = ReturnType<typeof createPluginRuntime>;
