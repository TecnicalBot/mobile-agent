import { asSchema, jsonSchema, type JSONSchema7, type ToolSet } from "ai";

/**
 * Anthropic (and other strict providers) require every tool's `input_schema`
 * to declare a top-level `type`. Zod serializes discriminated unions as a bare
 * `oneOf`, and an empty object schema as just `$schema`, so normalize those
 * schemas at the provider boundary. The original validator is preserved so
 * tool arguments are still checked exactly as before.
 */
export function normalizeToolInputSchemas<T extends ToolSet | undefined>(
  tools: T,
): T {
  if (!tools) return tools;

  let changed = false;
  const normalized: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    const schema = asSchema(tool.inputSchema);
    const json = schema.jsonSchema as JSONSchema7 | PromiseLike<JSONSchema7>;

    if (
      json &&
      typeof json === "object" &&
      typeof (json as PromiseLike<JSONSchema7>).then !== "function" &&
      !("type" in json)
    ) {
      normalized[name] = {
        ...tool,
        inputSchema: jsonSchema(
          { ...(json as JSONSchema7), type: "object" },
          { validate: schema.validate },
        ),
      };
      changed = true;
      continue;
    }

    normalized[name] = tool;
  }

  return (changed ? normalized : tools) as T;
}
