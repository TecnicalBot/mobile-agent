import { describe, expect, it, vi } from "vitest";
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

  it("skips missing files and keeps oversized files for host upload", async () => {
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
    expect(result.uploads.map((upload) => upload.file.displayName)).toEqual([
      "large.png",
    ]);
    expect(result.uploads[0]?.bytes).toEqual(bytes("abc"));
    expect(result.skipped).toEqual(["missing.png"]);
  });

  it("leaves oversized files to the native upload handle when available", async () => {
    const read = vi.fn(async () => bytes("abc"));
    const upload = vi.fn(async () => ({ status: 200, body: "{}" }));
    const result = await buildOpenCodePromptFiles({
      files: [
        file("large", "large.png", MAX_OPENCODE_ATTACHMENT_BYTES + 1),
      ],
      resolveFile: () => ({
        exists: true,
        size: MAX_OPENCODE_ATTACHMENT_BYTES + 1,
        bytes: read,
        upload,
      }),
    });

    expect(read).not.toHaveBeenCalled();
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0]?.source?.upload).toBe(upload);
    expect(result.uploads[0]?.bytes).toBeUndefined();
    expect(result.uploads[0]?.size).toBe(MAX_OPENCODE_ATTACHMENT_BYTES + 1);
  });

  it("moves files over the shared inline budget to host uploads", async () => {
    const firstBytes = new Uint8Array(11 * 1024 * 1024);
    const result = await buildOpenCodePromptFiles({
      files: [
        file("first", "first.png", firstBytes.byteLength),
        file("second", "second.png", 10 * 1024 * 1024),
      ],
      resolveFile: (path) => ({
        exists: true,
        size: path === "files/first" ? firstBytes.byteLength : 10 * 1024 * 1024,
        bytes: async () =>
          path === "files/first" ? firstBytes : bytes("abc"),
      }),
    });

    expect(result.files.map((attachment) => attachment.name)).toEqual([
      "first.png",
    ]);
    expect(result.uploads.map((upload) => upload.file.displayName)).toEqual([
      "second.png",
    ]);
    expect(result.skipped).toEqual([]);
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
