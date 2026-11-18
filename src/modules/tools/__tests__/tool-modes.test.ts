import { describe, expect, it } from "vitest";

import {
  isToolModeCommandInput,
  parseToolModeCommand,
} from "@/modules/tools/tool-modes";

describe("tool mode commands", () => {
  it("ignores ordinary prompts", () => {
    expect(parseToolModeCommand("make me a video", ["core"])).toBeNull();
    expect(isToolModeCommandInput("/videos")).toBe(false);
  });

  it("enables media with /video", () => {
    const command = parseToolModeCommand("/video", ["core"]);

    expect(command?.families).toEqual(["core", "media"]);
  });

  it("disables media with /video off and keeps other families", () => {
    const command = parseToolModeCommand("  /VIDEO   OFF ", [
      "core",
      "media",
      "documents",
    ]);

    expect(command?.families).toEqual(["core", "documents"]);
  });

  it("stacks documents on top of media", () => {
    expect(parseToolModeCommand("/docs", ["core", "media"])?.families).toEqual([
      "core",
      "media",
      "documents",
    ]);
  });

  it("resets every optional family with /general", () => {
    expect(
      parseToolModeCommand("/general", ["core", "media", "documents"])
        ?.families,
    ).toEqual(["core"]);
  });

  it("persists core when handling a legacy null family set", () => {
    expect(parseToolModeCommand("/docs", null)?.families).toEqual([
      "core",
      "documents",
    ]);
  });
});
