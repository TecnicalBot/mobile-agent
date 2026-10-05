import { describe, expect, it } from "vitest";
import type { WorkspaceFile } from "../../../core/types/app-state";
import { workspaceFileFromUrl } from "../workspace-link";

const file: WorkspaceFile = {
  id: "abc-123", displayName: "sales report.csv", originalName: null,
  relativePath: "abc-123-sales report.csv", mimeType: "text/csv", size: 42,
  sourceKind: "created", createdAt: "", updatedAt: "",
};

describe("workspaceFileFromUrl", () => {
  it("resolves canonical IDs and encoded local links", () => {
    for (const href of ["workspace://abc-123", "file:///workspace/abc-123-sales%20report.csv", "sandbox:/mnt/data/sales%20report.csv", "sales%20report.csv?download=1"]) {
      expect(workspaceFileFromUrl(href, [file])).toBe(file);
    }
  });
  it("does not intercept website links or guess between duplicate names", () => {
    expect(workspaceFileFromUrl("https://example.com/sales%20report.csv", [file])).toBeNull();
    const duplicate = { ...file, id: "other", relativePath: "other-sales report.csv" };
    expect(workspaceFileFromUrl("sales report.csv", [file, duplicate])).toBeNull();
    expect(workspaceFileFromUrl("workspace://abc-123", [file, duplicate])).toBe(file);
  });
});
