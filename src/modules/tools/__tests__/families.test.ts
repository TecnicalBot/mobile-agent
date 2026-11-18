import { describe, expect, it } from "vitest";

import {
  addToolFamily,
  describeToolFamilies,
  DOCUMENT_TOOL_NAMES,
  filterToolsByFamilies,
  hasToolFamily,
  hiddenToolNames,
  MEDIA_TOOL_NAMES,
  normalizeToolFamilies,
  pickEssentialTools,
  removeToolFamily,
  toolFamilyForBuiltInKey,
  toolFamilyForName,
} from "@/modules/tools/families";

describe("tool families", () => {
  it("always normalizes to core and drops unknown values", () => {
    expect(normalizeToolFamilies(undefined)).toEqual(["core"]);
    expect(normalizeToolFamilies(["media", "media", "bogus"])).toEqual([
      "core",
      "media",
    ]);
  });

  it("maps optional tool names and defaults the rest to core", () => {
    expect(toolFamilyForName("renderVideo")).toBe("media");
    expect(toolFamilyForName("analyzeAudio")).toBe("media");
    expect(toolFamilyForName("splitPdf")).toBe("documents");
    expect(toolFamilyForName("read")).toBe("core");
    expect(toolFamilyForName("someMcpTool")).toBe("core");
  });

  it("maps optional built-in keys from skills", () => {
    expect(toolFamilyForBuiltInKey("workspaceRenderVideo")).toBe("media");
    expect(toolFamilyForBuiltInKey("workspaceCreateFile")).toBe("documents");
    expect(toolFamilyForBuiltInKey("workspaceRead")).toBeNull();
  });

  it("filters the catalog by the enabled families", () => {
    const tools = Object.fromEntries(
      [...MEDIA_TOOL_NAMES, ...DOCUMENT_TOOL_NAMES, "read", "write"].map(
        (name) => [name, { name }],
      ),
    );

    const coreOnly = filterToolsByFamilies(tools, ["core"]);
    expect(Object.keys(coreOnly).sort()).toEqual(["read", "write"]);

    const media = filterToolsByFamilies(tools, ["core", "media"]);
    expect(Object.keys(media).sort()).toEqual(
      ["read", "write", ...MEDIA_TOOL_NAMES].sort(),
    );

    expect(hiddenToolNames(tools, ["core", "media"])).toEqual(
      [...DOCUMENT_TOOL_NAMES].sort(),
    );
  });

  it("picks only the essential file tools for tiny windows", () => {
    const tools = Object.fromEntries(
      [
        "read",
        "write",
        "edit",
        "grep",
        "glob",
        "listFiles",
        "viewFile",
        "fetchPage",
        "todos",
      ].map((name) => [name, { name }]),
    );

    expect(Object.keys(pickEssentialTools(tools)).sort()).toEqual([
      "edit",
      "glob",
      "grep",
      "listFiles",
      "read",
      "viewFile",
      "write",
    ]);
  });

  it("adds and removes families without dropping core", () => {
    const media = addToolFamily(["core"], "media");
    expect(media).toEqual(["core", "media"]);

    const documents = addToolFamily(media, "documents");
    expect(documents).toEqual(["core", "media", "documents"]);

    expect(removeToolFamily(documents, "media")).toEqual([
      "core",
      "documents",
    ]);
    expect(removeToolFamily(documents, "core")).toEqual(documents);
  });

  it("reports membership and a readable label", () => {
    expect(hasToolFamily(["core"], "core")).toBe(true);
    expect(hasToolFamily(["core"], "media")).toBe(false);
    expect(describeToolFamilies(["core", "documents"])).toBe(
      "Core + Documents",
    );
  });
});
