import type {
  LoadedPlugin,
  PluginDefinition,
  PluginHostContext,
} from "./types";

export type SandboxResult =
  | { ok: true; plugin: LoadedPlugin }
  | { error: string; ok: false };

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runPluginSetup(input: {
  context: PluginHostContext;
  id: string;
  options?: Record<string, unknown>;
  source: string;
}): Promise<SandboxResult> {
  try {
    const module = { exports: {} as PluginDefinition | { default: PluginDefinition } };
    const factory = new Function(
      "api",
      "options",
      "module",
      "exports",
      `"use strict";\n${input.source}\nreturn module.exports;`,
    ) as (
      api: PluginHostContext,
      options: Record<string, unknown>,
      moduleValue: { exports: unknown },
      exportsValue: unknown,
    ) => PluginDefinition | { default: PluginDefinition };
    const exported = factory(
      input.context,
      input.options ?? {},
      module,
      module.exports,
    );
    const definition =
      "default" in exported ? exported.default : (exported as PluginDefinition);

    if (!definition || typeof definition.setup !== "function") {
      return {
        error: "Plugin must assign an object with setup(api, options) to module.exports.",
        ok: false,
      };
    }

    const hooks = await definition.setup(input.context, input.options);
    if (!hooks || typeof hooks !== "object") {
      return { error: "Plugin setup() must return a hooks object.", ok: false };
    }

    return { ok: true, plugin: { hooks, id: input.id } };
  } catch (error) {
    return { error: `Plugin setup failed: ${formatError(error)}`, ok: false };
  }
}
