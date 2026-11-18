import { describe, expect, it, vi } from "vitest";

import { createToolDiscoveryTools } from "@/modules/tools/discovery";

function fakeTool(description: string) {
  return { description, inputSchema: {} } as never;
}

function readOnlyNames(values: Record<string, unknown>) {
  return Object.keys(values);
}

function createCatalog(activeNames: string[]) {
  const active = new Set(activeNames);
  const all = {
    findTools: fakeTool("find"),
    enableTools: fakeTool("enable"),
    read: fakeTool("read a file"),
    renderVideo: fakeTool("render a video from HTML"),
    splitPdf: fakeTool("split a PDF into pages"),
  };

  return {
    all,
    get active() {
      return Object.fromEntries(
        Object.entries(all).filter(([name]) => active.has(name)),
      );
    },
    enable(names: string[]) {
      for (const name of names) {
        active.add(name);
      }
    },
  };
}

describe("tool discovery", () => {
  it("lists only hidden tools matching the query", async () => {
    const catalog = createCatalog(["findTools", "enableTools", "read"]);
    const { tools } = createToolDiscoveryTools({
      getCatalog: () => ({ all: catalog.all, active: catalog.active }),
      onEnableFamilies: () => true,
    });

    const magicTools = (tools as Record<string, { execute: unknown }>);
    const result = (await (
      magicTools.findTools.execute as (input: unknown) => Promise<unknown>
    )({ query: "video" })) as {
      tools: { name: string; family: string }[];
    };

    expect(result.tools.map((entry) => entry.name)).toEqual(["renderVideo"]);
    expect(result.tools[0].family).toBe("media");
  });

  it("enables a family and exposes its sibling tools", async () => {
    const catalog = createCatalog(["findTools", "enableTools", "read"]);
    const onEnableFamilies = vi.fn(async (families: string[]) => {
      catalog.enable(
        families.includes("media")
          ? ["renderVideo"]
          : ["splitPdf"],
      );
      return true;
    });
    const { tools } = createToolDiscoveryTools({
      getCatalog: () => ({ all: catalog.all, active: catalog.active }),
      onEnableFamilies,
    });

    const result = (await (
      (tools as Record<string, { execute: unknown }>).enableTools
        .execute as (input: unknown) => Promise<unknown>
    )({ names: ["renderVideo"] })) as {
      enabled: string[];
      families: string[];
    };

    expect(onEnableFamilies).toHaveBeenCalledWith(["media"]);
    expect(result.enabled).toEqual(["renderVideo"]);
    expect(result.families).toEqual(["Video & audio"]);
    expect(readOnlyNames(catalog.active)).toContain("renderVideo");
  });

  it("refuses to enable tools that do not fit the context window", async () => {
    const catalog = createCatalog(["findTools", "enableTools", "read"]);
    const { tools } = createToolDiscoveryTools({
      getCatalog: () => ({ all: catalog.all, active: catalog.active }),
      onEnableFamilies: () => false,
    });

    const result = (await (
      (tools as Record<string, { execute: unknown }>).enableTools
        .execute as (input: unknown) => Promise<unknown>
    )({ names: ["renderVideo"] })) as {
      enabled: string[];
      note: string;
    };

    expect(result.enabled).toEqual([]);
    expect(result.note).toContain("not enough context window");
  });
});
