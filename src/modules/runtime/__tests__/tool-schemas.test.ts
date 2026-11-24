import { asSchema, tool, type JSONSchema7 } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizeToolInputSchemas } from "@/modules/runtime/tool-schemas";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), url: z.string() }),
  z.object({ action: z.literal("close") }),
]);

describe("normalizeToolInputSchemas", () => {
  it("returns undefined for a missing tool set", () => {
    expect(normalizeToolInputSchemas(undefined)).toBeUndefined();
  });

  it("adds a top-level object type to union schemas", async () => {
    const tools = {
      browser: tool({ inputSchema: actionSchema, execute: async () => "ok" }),
    };

    const [normalized] = Object.values(
      normalizeToolInputSchemas(tools) as typeof tools,
    );
    const schema = asSchema(normalized.inputSchema);
    const json = schema.jsonSchema as JSONSchema7;

    expect(json).toMatchObject({ type: "object" });
    expect(json.oneOf).toHaveLength(2);
    // The original validator still runs.
    expect((await schema.validate?.({ action: "open", url: "x" }))?.success).toBe(
      true,
    );
    expect((await schema.validate?.({ action: "open" }))?.success).toBe(false);
  });

  it("adds a top-level object type to empty schemas", () => {
    const tools = {
      noArgs: tool({
        inputSchema: z.fromJSONSchema({}),
        execute: async () => "ok",
      }),
    };

    const [normalized] = Object.values(
      normalizeToolInputSchemas(tools) as typeof tools,
    );

    expect(asSchema(normalized.inputSchema).jsonSchema).toMatchObject({
      type: "object",
    });
  });

  it("leaves schemas that already declare a type untouched", () => {
    const tools = {
      read: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async () => "ok",
      }),
    };

    const normalized = normalizeToolInputSchemas(tools);

    expect(normalized).toBe(tools);
  });
});
