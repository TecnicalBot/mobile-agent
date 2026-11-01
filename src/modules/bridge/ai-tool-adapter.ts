import { asSchema, type Tool, type ToolSet } from "ai";
import type { BridgeContent, BridgeTool } from "./types";

/** Structural subset of AI SDK's ToolResultOutput, including legacy shapes. */
type ModelOutput = {
  type: string;
  value?: unknown;
  reason?: string;
};

type ModelContentPart = {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mediaType?: unknown;
  filename?: unknown;
};

type ModelOutputTool = {
  toModelOutput?: (options: {
    toolCallId: string;
    input: unknown;
    output: unknown;
  }) => ModelOutput | PromiseLike<ModelOutput>;
};

function bytesToBase64(data: string | Uint8Array | ArrayBuffer): string {
  if (typeof data === "string") return data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function textContent(text: string): BridgeContent {
  return { type: "text", text };
}

function fileContent(
  data: unknown,
  mediaType: unknown,
): BridgeContent | null {
  if (typeof mediaType !== "string") return null;
  if (
    typeof data !== "string" &&
    !(data instanceof Uint8Array) &&
    !(data instanceof ArrayBuffer)
  )
    return null;
  if (mediaType.startsWith("image/"))
    return {
      type: "image",
      data: bytesToBase64(data),
      mimeType: mediaType,
    };
  if (mediaType.startsWith("audio/"))
    return {
      type: "audio",
      data: bytesToBase64(data),
      mimeType: mediaType,
    };
  return null;
}

function contentPartsToBridgeContent(value: unknown): BridgeContent[] {
  const content: BridgeContent[] = [];
  const omitted: string[] = [];
  const parts = Array.isArray(value) ? value : [];

  for (const item of parts) {
    if (!item || typeof item !== "object") continue;
    const part = item as ModelContentPart;
    if (part.type === "text" && typeof part.text === "string") {
      content.push(textContent(part.text));
      continue;
    }

    if (part.type === "file" || part.type === "file-data") {
      const raw =
        part.data &&
        typeof part.data === "object" &&
        "type" in part.data
          ? (part.data as { type?: unknown; data?: unknown })
          : null;
      const data =
        raw?.type === "data"
          ? raw.data
          : typeof part.data === "string"
            ? part.data
            : null;
      const file = fileContent(data, part.mediaType);
      if (file) content.push(file);
      else
        omitted.push(
          typeof part.filename === "string"
            ? part.filename
            : typeof part.mediaType === "string"
              ? part.mediaType
              : "file",
        );
    }
  }

  if (omitted.length > 0)
    content.push(
      textContent(
        `[Binary content not returned through the phone bridge: ${omitted.join(", ")}]`,
      ),
    );
  return content.length > 0
    ? content
    : [textContent("The tool returned no content.")];
}

/**
 * MCP has first-class image/audio content blocks. Reuse each tool's
 * `toModelOutput` so the bridge sends exactly the media the direct runtime
 * would, rather than serializing Uint8Array bytes into the result text.
 */
function modelOutputToBridgeContent(output: ModelOutput): BridgeContent[] {
  switch (output.type) {
    case "text":
    case "error-text":
      return [
        textContent(
          typeof output.value === "string"
            ? output.value
            : String(output.value ?? ""),
        ),
      ];
    case "json":
    case "error-json":
      return [textContent(JSON.stringify(output.value ?? null))];
    case "execution-denied":
      return [
        textContent(
          typeof output.reason === "string"
            ? output.reason
            : "The tool call was denied.",
        ),
      ];
    case "content":
      return contentPartsToBridgeContent(output.value);
    default:
      return [textContent(JSON.stringify(output))];
  }
}

/** Adapt existing factories without reimplementing their schemas or execution logic. */
export function adaptAiBridgeTool(
  name: string,
  tool: ToolSet[string],
  readOnly: boolean,
): BridgeTool {
  const schema = asSchema(tool.inputSchema);
  const toModelOutput = (tool as ToolSet[string] & ModelOutputTool).toModelOutput;
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
    ...(toModelOutput
      ? {
          async toContent(input: unknown, output: unknown) {
            try {
              return modelOutputToBridgeContent(
                await toModelOutput({ toolCallId: name, input, output }),
              );
            } catch {
              // A conversion failure must not turn a successful tool call into
              // a failed one. Prefer the result's text over JSON-stringifying
              // any media bytes that the failed conversion was meant to carry.
              if (
                output &&
                typeof output === "object" &&
                "text" in output &&
                typeof output.text === "string"
              )
                return [textContent(output.text)];
              return null;
            }
          },
        }
      : {}),
  };
}
