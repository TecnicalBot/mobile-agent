import type { PluginConfig } from "@/core/types/app-state";

import { readPluginFile } from "./plugin-files";
import { runPluginSetup } from "./sandbox";
import type { LoadedPlugin, PluginHostContext } from "./types";

export async function loadAllPlugins(
  configs: PluginConfig[],
  createContext: (
    id: string,
    options?: Record<string, unknown>,
  ) => PluginHostContext,
) {
  const errors: { error: string; id: string }[] = [];
  const plugins: LoadedPlugin[] = [];

  for (const config of configs) {
    if (!config.enabled) continue;

    const source = await readPluginFile(config.id);
    if (!source) {
      errors.push({ error: "Plugin file not found on disk", id: config.id });
      continue;
    }

    const context = createContext(config.id, config.options ?? undefined);
    const result = await runPluginSetup({
      context,
      id: config.id,
      options: config.options ?? undefined,
      source,
    });
    if (result.ok) {
      plugins.push({ ...result.plugin, context });
    } else {
      errors.push({ error: result.error, id: config.id });
    }
  }

  return { errors, plugins };
}
