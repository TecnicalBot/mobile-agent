import { describe, expect, it } from "vitest";

import { formatSummaryLines, parseToolSummary } from "../tool-summary";

describe("parseToolSummary", () => {
  it("returns complete objects as they are", () => {
    expect(parseToolSummary('{"count":5,"files":["a.ts"]}')).toEqual({
      count: 5,
      files: ["a.ts"],
    });
  });

  it("returns nothing for null, empty, arrays, and non-JSON text", () => {
    expect(parseToolSummary(null)).toEqual({});
    expect(parseToolSummary("")).toEqual({});
    expect(parseToolSummary("[1,2]")).toEqual({});
    expect(parseToolSummary("plain text")).toEqual({});
  });

  it("recovers scalars and whole strings from a summary cut mid-object", () => {
    // summarizeValue caps summaries at 240 chars, so this is the common case.
    const truncated =
      '{"total":316,"returned":100,"truncated":true,"files":["circle.mp4","circle-mo';

    expect(parseToolSummary(truncated)).toEqual({
      total: 316,
      returned: 100,
      truncated: true,
      files: ["circle.mp4"],
    });
  });

  it("recovers escaped string values", () => {
    const truncated = '{"path":"a \\"quoted\\" name.md","note';

    expect(parseToolSummary(truncated)).toMatchObject({
      path: 'a "quoted" name.md',
    });
  });

  it("does not flatten array bodies that hold objects", () => {
    const truncated =
      '{"count":1,"matches":[{"path":"a.md","content":"x"},{"path":"b.md"';

    expect(parseToolSummary(truncated)).toMatchObject({ count: 1 });
    expect(parseToolSummary(truncated).matches).toBeUndefined();
  });
});

describe("formatSummaryLines", () => {
  it("renders scalars and list values", () => {
    expect(formatSummaryLines('{"count":5,"files":["a.ts","b.ts"]}')).toEqual([
      "count: 5",
      "files: a.ts, b.ts",
    ]);
  });

  it("formats byte sizes and durations for humans", () => {
    expect(
      formatSummaryLines('{"size":123469,"duration":5,"sizeBytes":2048}'),
    ).toEqual(["size: 121 KB", "duration: 5s", "size Bytes: 2.0 KB"]);
  });

  it("labels object-array items by their readable field", () => {
    const summary =
      '{"entries":[{"path":"docs","kind":"directory"},{"path":"a.md","kind":"file"}]}';

    expect(formatSummaryLines(summary)).toEqual(["entries: docs, a.md"]);
  });

  it("keeps the keys the renderer paints itself out of the lines", () => {
    const summary =
      '{"fileId":"abc","displayName":"a.md","mimeType":"text/markdown","status":"completed"}';

    expect(formatSummaryLines(summary)).toEqual(["status: completed"]);
  });

  it("renders nothing for missing, empty, or plain-text summaries", () => {
    expect(formatSummaryLines(null)).toEqual([]);
    expect(formatSummaryLines("")).toEqual([]);
    expect(formatSummaryLines("No files found")).toEqual([]);
  });

  it("renders the scalars of a truncated list summary", () => {
    const truncated =
      '{"total":316,"returned":100,"truncated":true,"files":["circle.mp4","circle-mo';

    expect(formatSummaryLines(truncated)).toEqual([
      "total: 316",
      "returned: 100",
      "truncated: true",
      "files: circle.mp4",
    ]);
  });
});
