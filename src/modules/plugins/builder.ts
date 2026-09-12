import { runPluginSetup } from "./sandbox";
import type { PluginHostContext } from "./types";

const STUB_CONTEXT: PluginHostContext = {
  emit: () => {},
  fetch: async () => {
    throw new Error("fetch unavailable during validation");
  },
  log: () => {},
  secrets: { delete: async () => {}, get: async () => null, set: async () => {} },
  storage: { delete: async () => {}, get: async () => null, set: async () => {} },
};

export type PluginToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutating?: boolean;
  executeBody: string;
};

export type BuildPluginInput = {
  author?: string;
  description?: string;
  name: string;
  system?: string[];
  tools?: PluginToolSpec[];
  version: string;
};

function indentBlock(text: string, spaces: number) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join("\n");
}

export function buildPluginSource(input: BuildPluginInput): string {
  const manifest = Object.fromEntries(
    Object.entries({
      name: input.name,
      version: input.version,
      description: input.description?.trim() || undefined,
      author: input.author?.trim() || undefined,
    }).filter(([, v]) => v !== undefined),
  );

  const toolEntries = (input.tools ?? []).map((tool) => {
    const lines = [
      `    ${JSON.stringify(tool.name)}: {`,
      `      description: ${JSON.stringify(tool.description)},`,
      `      inputSchema: ${JSON.stringify(tool.inputSchema)},`,
      ...(tool.mutating ? ["      mutating: true,"] : []),
      "      async execute(args, context) {",
      indentBlock(tool.executeBody, 8),
      "      },",
      "    },",
    ];
    return lines.join("\n");
  });

  const hookBlocks = [
    ...(toolEntries.length > 0
      ? [["    tool: {", toolEntries.join("\n"), "    },"].join("\n")]
      : []),
    ...(input.system && input.system.length > 0
      ? [`    system: ${JSON.stringify(input.system)},`]
      : []),
  ];

  return [
    `// @mobile-agent-plugin ${JSON.stringify(manifest)}`,
    "",
    "module.exports = {",
    "  setup(api, options) {",
    "    return {",
    ...hookBlocks,
    "    };",
    "  },",
    "};",
    "",
  ].join("\n");
}

export type ValidationResult =
  | { ok: true; toolCount: number }
  | { ok: false; error: string };

export async function validatePluginSource(
  source: string,
): Promise<ValidationResult> {
  const result = await runPluginSetup({
    context: STUB_CONTEXT,
    id: "validation",
    source,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const toolCount = Object.keys(result.plugin.hooks.tool ?? {}).length;
  return { ok: true, toolCount };
}