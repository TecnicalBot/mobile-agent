import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalFolderSession } from "@/core/types/app-state";

const mocks = vi.hoisted(() => ({
  files: new Map<string, { name: string; size: number; type: string }>(),
  copy: vi.fn(),
  readBytes: vi.fn(() => { throw new Error("Must not load the entire file"); }),
  deleteFile: vi.fn(),
  create: vi.fn(),
  onRecord: vi.fn(),
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "import-id" }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("saf-file-operations", () => ({
  createSafEntry: vi.fn(),
  relocateSafEntry: vi.fn(),
}));
vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => typeof p === "string" ? p : p.uri).join("/");
    }
    get name() { return mocks.files.get(this.uri)?.name ?? ""; }
    get size() { return mocks.files.get(this.uri)?.size ?? 0; }
    get type() { return mocks.files.get(this.uri)?.type ?? ""; }
    get exists() { return mocks.files.has(this.uri); }
    bytes = mocks.readBytes;
    async copy(destination: File, options: unknown) {
      await mocks.copy(this.uri, destination.uri, options);
      mocks.files.set(destination.uri, mocks.files.get(this.uri)!);
    }
    delete() {
      mocks.deleteFile(this.uri);
      mocks.files.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | Directory)[]) {
      this.uri = parts.map((p) => typeof p === "string" ? p : p.uri).join("/");
    }
    get name() { return this.uri.split("/").at(-1) ?? ""; }
    exists = true;
    create() {}
    list() {
      if (this.uri === "content://grant") {
        return [new Directory("content://grant/clips")];
      }
      if (this.uri === "content://grant/clips") {
        return [...mocks.files.keys()]
          .filter((uri) => uri.startsWith("content://grant/clips/"))
          .map((uri) => new File(uri));
      }
      return [];
    }
  }
  return { File, Directory, Paths: { document: "file:///document" } };
});

const { createTransferTools } = await import(
  "@/modules/tools/built-in/external-folder/transfer"
);

const SESSION: ExternalFolderSession = {
  uri: "content://grant",
  displayName: "Picked folder",
  platform: "android",
  sourceType: "external-folder",
  grantedAt: "2026-11-21T00:00:00.000Z",
};
const SOURCE_URI = "content://grant/clips/large.mp4";
const LARGE_SIZE = 800_000_000;

function importFile(input: { path?: string; destinationName?: string; mode?: "copy" | "move" } = {}) {
  const tools = createTransferTools({
    repository: { create: mocks.create } as never,
    session: SESSION,
    onRecord: mocks.onRecord,
  });
  const tool = tools.importFolderFileToWorkspace as unknown as {
    execute: (input: object, options: object) => Promise<unknown>;
  };
  return tool.execute({ path: "clips/large.mp4", mode: "copy", ...input }, {});
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.files.set(SOURCE_URI, { name: "large.mp4", size: LARGE_SIZE, type: "video/mp4" });
  mocks.copy.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (input) => input);
});

describe("folder-to-workspace transfer", () => {
  it("copies large media natively without reading its contents into memory", async () => {
    const result = await importFile();
    expect(mocks.copy).toHaveBeenCalledWith(
      SOURCE_URI,
      expect.stringContaining("file:///document/mobile-agent/workspace/"),
      { overwrite: true },
    );
    expect(mocks.readBytes).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "import-id",
      displayName: "large.mp4",
      mimeType: "video/mp4",
      size: LARGE_SIZE,
      sourceKind: "imported",
    }));
    expect(result).toMatchObject({ workspaceFileId: "import-id", size: LARGE_SIZE, mode: "copy" });
    expect(mocks.files.has(SOURCE_URI)).toBe(true);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("preserves custom destination names and MIME metadata", async () => {
    await importFile({ destinationName: "holiday.mp4" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "holiday.mp4",
      originalName: "holiday.mp4",
      mimeType: "video/mp4",
    }));
    expect(mocks.readBytes).not.toHaveBeenCalled();
  });

  it("deletes the source for moves only after the workspace copy is persisted", async () => {
    mocks.create.mockImplementation(async (input) => {
      expect(mocks.files.has(SOURCE_URI)).toBe(true);
      return input;
    });
    await importFile({ mode: "move" });
    expect(mocks.copy.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteFile.mock.invocationCallOrder[0]);
    expect(mocks.files.has(SOURCE_URI)).toBe(false);
  });

  it.each(["copy", "persist"])("keeps the source if %s fails during a move", async (stage) => {
    if (stage === "copy") mocks.copy.mockRejectedValueOnce(new Error("copy failed"));
    else mocks.create.mockRejectedValueOnce(new Error("persist failed"));
    await expect(importFile({ mode: "move" })).rejects.toThrow(`${stage} failed`);
    expect(mocks.files.has(SOURCE_URI)).toBe(true);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.onRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it.each(["../large.mp4", "/large.mp4", "content://other/large.mp4", "clips/missing.mp4"])(
    "rejects an unavailable or out-of-grant path: %s",
    async (path) => {
      await expect(importFile({ path })).rejects.toThrow();
      expect(mocks.copy).not.toHaveBeenCalled();
      expect(mocks.readBytes).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
});
