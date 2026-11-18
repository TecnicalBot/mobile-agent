import type { ToolFamily } from "@/core/types/app-state";

import {
  addToolFamily,
  describeToolFamilies,
  normalizeToolFamilies,
  removeToolFamily,
  TOOL_FAMILY_LABELS,
} from "./families";

export type ToolModeCommandId = "video" | "docs" | "general";

export type ToolModeCommand = {
  families: ToolFamily[];
  id: ToolModeCommandId;
  /** Short confirmation suitable for a toast/alert. */
  message: string;
};

export type ToolModeCommandDefinition = {
  command: string;
  family: ToolFamily | null;
  id: ToolModeCommandId;
  label: string;
  subtitle: string;
};

/**
 * Commands shown in the composer slash menu. `/video off` and `/docs off`
 * are typed, not listed, to keep the menu short.
 */
export const TOOL_MODE_COMMANDS: ToolModeCommandDefinition[] = [
  {
    command: "/video",
    family: "media",
    id: "video",
    label: "Video & audio tools",
    subtitle: "Render, inspect, transcribe, and voice media · /video",
  },
  {
    command: "/docs",
    family: "documents",
    id: "docs",
    label: "Document tools",
    subtitle: "Create, split, merge, and update documents · /docs",
  },
  {
    command: "/general",
    family: null,
    id: "general",
    label: "Reset tool modes",
    subtitle: "Back to core tools only · /general",
  },
];

const COMMAND_ALIASES: Record<string, { id: ToolModeCommandId; off: boolean }> = {
  "/video": { id: "video", off: false },
  "/video off": { id: "video", off: true },
  "/video on": { id: "video", off: false },
  "/docs": { id: "docs", off: false },
  "/docs off": { id: "docs", off: true },
  "/docs on": { id: "docs", off: false },
  "/documents": { id: "docs", off: false },
  "/documents off": { id: "docs", off: true },
  "/general": { id: "general", off: false },
  "/general off": { id: "general", off: false },
};

const COMMAND_FAMILY: Record<ToolModeCommandId, ToolFamily | null> = {
  video: "media",
  docs: "documents",
  general: null,
};

export function isToolModeCommandInput(input: string): boolean {
  return Boolean(parseToolModeCommand(input, ["core"]));
}

/**
 * Parses a mode command and returns the resulting family set. Returns null
 * for ordinary chat messages so callers can treat the text as a prompt.
 */
export function parseToolModeCommand(
  input: string,
  currentFamilies: ToolFamily[] | null | undefined,
): ToolModeCommand | null {
  const normalized = input.trim().replace(/\s+/g, " ").toLowerCase();
  const match = COMMAND_ALIASES[normalized];

  if (!match) {
    return null;
  }

  const base = normalizeToolFamilies(currentFamilies);
  const family = COMMAND_FAMILY[match.id];

  if (!family) {
    return {
      families: normalizeToolFamilies([]),
      id: match.id,
      message: "Tool modes reset to core tools.",
    };
  }

  const families = match.off
    ? removeToolFamily(base, family)
    : addToolFamily(base, family);
  const label = TOOL_FAMILY_LABELS[family];

  return {
    families,
    id: match.id,
    message: match.off
      ? `${label} tools disabled. Active: ${describeToolFamilies(families)}.`
      : `${label} tools enabled for this chat. Active: ${describeToolFamilies(families)}.`,
  };
}
