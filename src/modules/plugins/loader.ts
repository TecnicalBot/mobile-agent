import type { PluginConfig } from "@/core/types/app-state";

import { runPluginSetup } from "./sandbox";
import type { LoadedPlugin, PluginHostContext } from "./types";

export async function loadAllPlugins(
  configs: PluginConfig[],
  createContext: (id: string) => PluginHostContext,
) {
  const errors: { error: string; id: string }[] = [];
  const plugins: LoadedPlugin[] = [];

  for (const config of configs) {
    if (!config.enabled) continue;

    const result = await runPluginSetup({
      context: createContext(config.id),
      id: config.id,
      options: config.options ?? undefined,
      source: config.source,
    });
    if (result.ok) plugins.push(result.plugin);
    else errors.push({ error: result.error, id: config.id });
  }

  return { errors, plugins };
}
