import { asSchema, type Tool, type ToolSet } from "ai";
import type { BridgeTool } from "./types";

/** Adapt existing factories without reimplementing their schemas or execution logic. */
export function adaptAiBridgeTool(
  name: string,
  tool: ToolSet[string],
  readOnly: boolean,
): BridgeTool {
  const schema = asSchema(tool.inputSchema);
  return {
    name,
    description: typeof tool.description === "string" ? tool.description : name,
    readOnly,
    get inputSchema() {
      return { ...schema.jsonSchema, type: "object" as const };
    },
    async parse(input) {
      if (!schema.validate)
        throw new Error("Shared tools must validate input.");
      const result = await schema.validate(input);
      if (!result.success) throw new Error("Invalid tool arguments.");
      return result.value;
    },
    async execute(input, signal) {
      if (!tool.execute) throw new Error("This tool cannot execute.");
      const execute = (tool as Tool<unknown, unknown>).execute!;
      const result = execute(input, {
        toolCallId: name,
        messages: [],
        abortSignal: signal,
        context: {},
      });
      if (
        result &&
        typeof result === "object" &&
        Symbol.asyncIterator in result
      )
        throw new Error("Streaming tools need an explicit bridge adapter.");
      return await result;
    },
  };
}
