import { describe, expect, it } from "vitest";
import {
  buildToolPreview,
  TOOL_PREVIEW_TEXT_LIMIT,
} from "./tool-preview";

describe("shared tool trace previews", () => {
  it("picks the useful object from tool input", () => {
    expect(
      buildToolPreview({
        fallbackTitle: "read",
        input: { filePath: "/repo/src/app.ts" },
      }).title,
    ).toBe("/repo/src/app.ts");
    expect(
      buildToolPreview({
        fallbackTitle: "grep",
        input: { pattern: "needle", path: "/repo" },
      }).title,
    ).toBe("needle");
    expect(
      buildToolPreview({
        fallbackTitle: "shell",
        input: { command: "npm test", description: "Run tests" },
      }).title,
    ).toBe("npm test");
  });

  it("captures text content and marks truncated previews", () => {
    expect(
      buildToolPreview({
        fallbackTitle: "read",
        input: { filePath: "/repo/a.ts" },
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
      }),
    ).toMatchObject({
      title: "/repo/a.ts",
      text: "line one\nline two",
      truncated: false,
    });

    const long = "x".repeat(TOOL_PREVIEW_TEXT_LIMIT + 1);
    expect(
      buildToolPreview({
        fallbackTitle: "shell",
        input: { command: "cat big.log" },
        content: [{ type: "text", text: long }],
      }),
    ).toMatchObject({
      text: long.slice(0, TOOL_PREVIEW_TEXT_LIMIT),
      truncated: true,
    });
  });

  it("only renders images that are safe for this device", () => {
    expect(
      buildToolPreview({
        fallbackTitle: "read",
        input: { filePath: "/repo/photo.png" },
        content: [
          {
            type: "file",
            uri: "https://example.com/photo.png",
            mime: "image/png",
            name: "photo.png",
          },
        ],
      }),
    ).toMatchObject({
      uri: "https://example.com/photo.png",
      mimeType: "image/png",
    });

    expect(
      buildToolPreview({
        fallbackTitle: "read",
        input: { filePath: "/repo/secret.png" },
        content: [
          {
            type: "file",
            uri: "file:///repo/secret.png",
            mime: "image/png",
          },
        ],
      }),
    ).toMatchObject({ text: "[file] image/png" });

    expect(
      buildToolPreview({
        fallbackTitle: "read",
        input: { filePath: "/repo/local.png" },
        content: [
          {
            type: "file",
            uri: "file:///repo/local.png",
            mime: "image/png",
          },
        ],
        allowFileImages: true,
      }),
    ).toMatchObject({ uri: "file:///repo/local.png" });
  });

  it("still gives running/empty tool calls a trace-row title", () => {
    expect(
      buildToolPreview({ fallbackTitle: "shell", input: { command: "pwd" } }),
    ).toEqual({ title: "pwd" });
  });
});
