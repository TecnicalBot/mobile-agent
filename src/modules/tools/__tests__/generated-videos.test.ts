import { describe, expect, it } from "vitest";

import { collectGeneratedVideos } from "@/modules/tools/generated-videos";

describe("collectGeneratedVideos", () => {
  it("returns an empty list for missing results", () => {
    expect(collectGeneratedVideos(undefined)).toEqual([]);
    expect(collectGeneratedVideos([])).toEqual([]);
  });

  it("ignores non-renderVideo and non-result entries", () => {
    expect(
      collectGeneratedVideos([
        { type: "tool-result", toolName: "createFile", output: { fileId: "x" } },
        { type: "tool-error", toolName: "renderVideo", output: {} },
      ]),
    ).toEqual([]);
  });

  it("maps a successful renderVideo output to an attachment", () => {
    expect(
      collectGeneratedVideos([
        {
          type: "tool-result",
          toolName: "renderVideo",
          output: {
            fileId: "abc",
            displayName: "scene.mp4",
            link: "workspace://abc",
            mimeType: "video/mp4",
            size: 2048,
          },
        },
      ]),
    ).toEqual([
      {
        fileId: "abc",
        displayName: "scene.mp4",
        mimeType: "video/mp4",
        size: 2048,
        uri: "workspace://abc",
      },
    ]);
  });

  it("deduplicates repeated file ids and fills defaults", () => {
    const results = collectGeneratedVideos([
      { type: "tool-result", toolName: "renderVideo", output: { fileId: "abc" } },
      { type: "tool-result", toolName: "renderVideo", output: { fileId: "abc" } },
    ]);

    expect(results).toEqual([
      {
        fileId: "abc",
        displayName: "abc.mp4",
        mimeType: "video/mp4",
        size: 0,
        uri: "workspace://abc",
      },
    ]);
  });

  it("attaches the playable video from an exportEditorPackage result, not the ZIP", () => {
    expect(
      collectGeneratedVideos([
        {
          type: "tool-result",
          toolName: "exportEditorPackage",
          output: {
            fileId: "zip-1",
            displayName: "scene-editor-package.zip",
            link: "workspace://zip-1",
            mimeType: "application/zip",
            videoFileId: "video-1",
            videoDisplayName: "scene.mp4",
            videoLink: "workspace://video-1",
            videoSize: 4096,
          },
        },
      ]),
    ).toEqual([
      {
        fileId: "video-1",
        displayName: "scene.mp4",
        mimeType: "video/mp4",
        size: 4096,
        uri: "workspace://video-1",
      },
    ]);
  });

  it("ignores an editor package that returned no playable video", () => {
    expect(
      collectGeneratedVideos([
        {
          type: "tool-result",
          toolName: "exportEditorPackage",
          output: { fileId: "zip-1", mimeType: "application/zip" },
        },
      ]),
    ).toEqual([]);
  });
});
