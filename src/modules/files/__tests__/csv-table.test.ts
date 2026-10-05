import { describe, expect, it } from "vitest";

import {
  parseDelimitedText,
  parseSpreadsheetText,
} from "@/modules/files/csv-table";

describe("parseDelimitedText", () => {
  it("splits simple rows", () => {
    expect(parseDelimitedText("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps quoted commas and escaped quotes intact", () => {
    expect(parseDelimitedText('name,note\n"Ada, Lovelace","said ""hi"""')).toEqual([
      ["name", "note"],
      ["Ada, Lovelace", 'said "hi"'],
    ]);
  });

  it("handles CRLF endings and drops a trailing blank row", () => {
    expect(parseDelimitedText("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("supports tabs as the delimiter", () => {
    expect(parseDelimitedText("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseSpreadsheetText", () => {
  it("uses a tab delimiter for .tsv files", () => {
    expect(parseSpreadsheetText("a\tb\n1\t2", "data.tsv")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
