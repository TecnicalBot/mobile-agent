import { describe, expect, it } from "vitest";
import { workspacePathSegments } from "./workspace-path";

describe("workspace path confinement", () => {
  it("accepts nested workspace paths", () => {
    expect(workspacePathSegments("images/report.png")).toEqual([
      "images",
      "report.png",
    ]);
  });
  it.each([
    "../database.db",
    "images/../../secrets",
    "/data/private",
    "file:///private",
    "a\\..\\private",
    "./private",
    "a/../private",
    "",
    "a\u0000b",
  ])("rejects %s", (path) => {
    expect(() => workspacePathSegments(path)).toThrow();
  });
});
