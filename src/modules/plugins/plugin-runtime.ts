import * as SecureStore from "expo-secure-store";
import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

import type { PluginConfig } from "@/core/types/app-state";

import { loadAllPlugins } from "./loader";
import type {
  LoadedPlugin,
  PluginEventName,
  PluginHostContext,
  PluginKeyValueStore,
  PluginRuntimeSnapshot,
} from "./types";

type PluginStorageRepository = {
  delete(pluginId: string, key: string): Promise<void>;
  get(pluginId: string, key: string): Promise<string | null>;
  set(pluginId: string, key: string, value: string): Promise<void>;
};

function secureKey(pluginId: string, key: string) {
  return `plugin_${pluginId.replace(/[^a-zA-Z0-9._-]/g, "_")}_${key.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

function createSecretStore(pluginId: string): PluginKeyValueStore {
  return {
    delete: (key) => SecureStore.deleteItemAsync(secureKey(pluginId, key)),
    get: (key) => SecureStore.getItemAsync(secureKey(pluginId, key)),
    set: (key, value) =>
      SecureStore.setItemAsync(secureKey(pluginId, key), value),
  };
}

function toolPrefix(pluginId: string) {
  return `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}_`;
}

export function createPluginRuntime(storage: PluginStorageRepository) {
  let loaded: LoadedPlugin[] = [];

  const createContext = (pluginId: string): PluginHostContext => ({
    emit(event, payload) {
      console.log(`[plugin:${pluginId}] ${event}`, payload);
    },
    fetch: (request, init) => globalThis.fetch(request, init),
    log: (...args) => console.log(`[plugin:${pluginId}]`, ...args),
    secrets: createSecretStore(pluginId),
    storage: {
      delete: (key) => storage.delete(pluginId, key),
      get: (key) => storage.get(pluginId, key),
      set: (key, value) => storage.set(pluginId, key, value),
    },
  });

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

      for (const plugin of loaded) {
        const prefix = toolPrefix(plugin.id);
        for (const [name, definition] of Object.entries(plugin.hooks.tool ?? {})) {
          const runtimeName = `${prefix}${name}`;
          try {
            tools[runtimeName] = tool({
              description: definition.description,
              inputSchema: z.fromJSONSchema(definition.inputSchema),
              execute: async (args, context) => {
                const result = await definition.execute(
                  args as Record<string, unknown>,
                  {
                    abortSignal:
                      context.abortSignal ?? new AbortController().signal,
                  },
                );
                return typeof result === "string" ? result : result.output;
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
        autoApprovedToolNames,
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
      };
    },
  };
}

export type PluginRuntime = ReturnType<typeof createPluginRuntime>;
