import { describe, expect, it } from "vitest";
import type { WorkspaceFile } from "@/core/types/app-state";
import {
  buildOpenCodePromptFiles,
  bytesToBase64,
  MAX_OPENCODE_ATTACHMENT_BYTES,
  MAX_OPENCODE_ATTACHMENTS,
} from "./opencode-attachments";

function file(id: string, displayName: string, size: number): WorkspaceFile {
  return {
    id,
    displayName,
    relativePath: `files/${id}`,
    mimeType: "image/png",
    size,
  } as WorkspaceFile;
}

const bytes = (value: string) => new TextEncoder().encode(value);

describe("OpenCode prompt attachments", () => {
  it("encodes workspace files as data URLs", async () => {
    const result = await buildOpenCodePromptFiles({
      files: [file("a", "a.png", 3)],
      resolveFile: () => ({
        exists: true,
        size: 3,
        bytes: async () => bytes("abc"),
      }),
    });

    expect(result.skipped).toEqual([]);
    expect(result.files).toEqual([
      {
        uri: `data:image/png;base64,${bytesToBase64(bytes("abc"))}`,
        name: "a.png",
      },
    ]);
  });

  it("skips missing and oversized files instead of failing the prompt", async () => {
    const result = await buildOpenCodePromptFiles({
      files: [
        file("missing", "missing.png", 3),
        file("large", "large.png", MAX_OPENCODE_ATTACHMENT_BYTES + 1),
      ],
      resolveFile: (path) => ({
        exists: path !== "files/missing",
        size:
          path === "files/large"
            ? MAX_OPENCODE_ATTACHMENT_BYTES + 1
            : 3,
        bytes: async () => bytes("abc"),
      }),
    });

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual(["missing.png", "large.png"]);
  });

  it("caps the number of attachments", async () => {
    const files = Array.from(
      { length: MAX_OPENCODE_ATTACHMENTS + 2 },
      (_, index) => file(`f${index}`, `f${index}.png`, 1),
    );
    const result = await buildOpenCodePromptFiles({
      files,
      resolveFile: () => ({ exists: true, size: 1, bytes: async () => bytes("a") }),
    });

    expect(result.files).toHaveLength(MAX_OPENCODE_ATTACHMENTS);
    expect(result.skipped).toHaveLength(2);
  });

  it("honours an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildOpenCodePromptFiles({
        files: [file("a", "a.png", 3)],
        resolveFile: () => ({
          exists: true,
          size: 3,
          bytes: async () => bytes("abc"),
        }),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Cancelled");
  });
});
