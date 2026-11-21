import { describe, expect, it } from "vitest";

import type { WorkspaceFile } from "@/core/types/app-state";
import {
  createLibraryCatalog,
  filterLibraryFiles,
  groupLibraryFiles,
  UNASSIGNED_LIBRARY_ID,
} from "@/modules/files/library-catalog";

const chat = { id: "chat-1", title: "Launch video", updatedAt: "2026-11-21T10:00:00.000Z" };

function file(id: string, overrides: Partial<WorkspaceFile> = {}) {
  return {
    id,
    displayName: `${id}.png`,
    originalName: null,
    mimeType: "image/png",
    size: 100,
    relativePath: `${id}/image.png`,
    sourceKind: "created" as const,
    sourceMarkdown: null,
    sourceSpec: null,
    createdAt: "2026-11-21T10:00:00.000Z",
    updatedAt: "2026-11-21T10:00:00.000Z",
    uri: `file:///${id}/image.png`,
    ...overrides,
  };
}

describe("library catalog", () => {
  it("links files to chats through explicit links and saved message references", () => {
    const catalog = createLibraryCatalog(
      [file("a"), file("b"), file("c")],
      [chat],
      [{ fileId: "a", conversationId: chat.id }],
    );
    catalog.addMessage({
      conversationId: chat.id,
      createdAt: "2026-11-21T10:00:00.000Z",
      content: "![storyboard](workspace://b)",
      metadata: { selectedFileIds: ["c"] },
    });
    const result = catalog.finish();

    expect(result.files.find((entry) => entry.id === "a")?.conversationIds).toEqual([chat.id]);
    expect(result.files.find((entry) => entry.id === "b")?.conversationIds).toEqual([chat.id]);
    expect(result.files.find((entry) => entry.id === "c")?.conversationIds).toEqual([chat.id]);
  });

  it("adds generated images that never became workspace files", () => {
    const catalog = createLibraryCatalog([], [chat]);
    catalog.addMessage({
      conversationId: chat.id,
      createdAt: "2026-11-21T10:00:00.000Z",
      content: "",
      metadata: {
        generatedImages: [
          { id: "image-1", mimeType: "image/jpeg", uri: "file:///generated/image-1.jpg" },
        ],
      },
    });
    const [generated] = catalog.finish().files;

    expect(generated).toMatchObject({
      displayName: "Generated image image-1.jpg",
      uri: "file:///generated/image-1.jpg",
      generated: true,
      conversationIds: [chat.id],
    });
  });

  it("hides preview stills unless intermediate files are included", () => {
    const catalog = createLibraryCatalog([file("still"), file("final")], [chat]);
    catalog.addMessage({
      conversationId: chat.id,
      createdAt: "2026-11-21T10:00:00.000Z",
      content: "",
      metadata: {
        toolExecutions: [
          {
            id: "preview",
            toolName: "previewScene",
            status: "completed",
            inputSummary: "{}",
            outputSummary: null,
            error: null,
            createdAt: "2026-11-21T10:00:00.000Z",
            outputData: { files: ["still"] },
          },
        ],
      },
    });
    const result = catalog.finish();
    const options = { query: "", category: "all" as const, conversationId: undefined };

    expect(filterLibraryFiles(result, { ...options, showIntermediate: false }).map((entry) => entry.id))
      .toEqual(["final"]);
    expect(filterLibraryFiles(result, { ...options, showIntermediate: true }).map((entry) => entry.id).sort())
      .toEqual(["final", "still"]);
  });

  it("searches file names and owning chat titles", () => {
    const catalog = createLibraryCatalog([file("a"), file("b")], [chat]);
    catalog.addMessage({
      conversationId: chat.id,
      createdAt: "2026-11-21T10:00:00.000Z",
      content: "",
      metadata: { selectedFileIds: ["a"] },
    });
    const result = catalog.finish();

    expect(filterLibraryFiles(result, {
      query: "launch", category: "all", showIntermediate: false,
    }).map((entry) => entry.id)).toEqual(["a"]);
    expect(filterLibraryFiles(result, {
      query: "b.png", category: "all", showIntermediate: false,
    }).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("groups by chat and keeps unlinked files reachable", () => {
    const catalog = createLibraryCatalog([file("a"), file("b")], [chat], [
      { fileId: "a", conversationId: chat.id },
    ]);
    const result = catalog.finish();
    const groups = groupLibraryFiles(result, result.files);

    expect(groups.map((group) => [group.id, group.files.map((entry) => entry.id)])).toEqual([
      [chat.id, ["a"]],
      [UNASSIGNED_LIBRARY_ID, ["b"]],
    ]);
  });

  it("filters media categories by mime type", () => {
    const catalog = createLibraryCatalog([
      file("photo"),
      file("clip", { displayName: "clip.mp4", mimeType: "video/mp4" }),
      file("doc", { displayName: "notes.txt", mimeType: "text/plain" }),
    ], [chat]);
    const result = catalog.finish();
    const options = { query: "", conversationId: undefined, showIntermediate: false };

    expect(filterLibraryFiles(result, { ...options, category: "videos" }).map((entry) => entry.id))
      .toEqual(["clip"]);
    expect(filterLibraryFiles(result, { ...options, category: "docs" }).map((entry) => entry.id))
      .toEqual(["doc"]);
  });
});
