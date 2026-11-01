import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adaptAiBridgeTool } from "./ai-tool-adapter";

describe("AI SDK tool bridge adapter", () => {
  it("turns file parts into MCP image content instead of JSON bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const viewFile = tool({
      description: "View a workspace file",
      inputSchema: z.object({ fileId: z.string() }),
      execute: async ({ fileId }: { fileId: string }) => ({
        text: `File ${fileId}`,
        mimeType: "image/png",
        file: bytes,
      }),
      toModelOutput: ({
        output,
      }: {
        output: { text: string; mimeType: string; file: Uint8Array };
      }) => ({
        type: "content" as const,
        value: [
          { type: "text" as const, text: output.text },
          {
            type: "file" as const,
            data: { type: "data" as const, data: output.file },
            mediaType: output.mimeType,
          },
        ],
      }),
    });
    const adapted = adaptAiBridgeTool("viewFile", viewFile, true);

    const output = await adapted.execute(
      { fileId: "image-1" },
      new AbortController().signal,
    );

    await expect(adapted.toContent?.({ fileId: "image-1" }, output)).resolves
      .toEqual([
        { type: "text", text: "File image-1" },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ]);
  });

  it("uses a text-only toModelOutput as plain text", async () => {
    const read = tool({
      description: "Read a workspace file",
      inputSchema: z.object({ fileId: z.string() }),
      execute: async () => ({ content: "hello" }),
      toModelOutput: ({ output }: { output: { content: string } }) => ({
        type: "text" as const,
        value: output.content,
      }),
    });
    const adapted = adaptAiBridgeTool("read", read, true);

    const output = await adapted.execute(
      { fileId: "text-1" },
      new AbortController().signal,
    );

    await expect(adapted.toContent?.({ fileId: "text-1" }, output)).resolves
      .toEqual([{ type: "text", text: "hello" }]);
  });
});
