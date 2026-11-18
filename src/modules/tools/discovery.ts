import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ToolExecutionRecord, ToolFamily } from "@/core/types/app-state";

import { createRecord, summarizeValue } from "./built-in/shared";
import {
  OPTIONAL_TOOL_NAMES,
  toolFamilyForName,
  TOOL_FAMILY_LABELS,
} from "./families";

const MAX_FIND_RESULTS = 12;

export type ToolDiscoveryCatalog = {
  /** Every approved tool available to the run, including hidden ones. */
  all: ToolSet;
  /** The subset the model can currently see. */
  active: ToolSet;
};

function describeTool(toolDefinition: unknown): string {
  const description =
    toolDefinition && typeof toolDefinition === "object"
      ? (toolDefinition as { description?: unknown }).description
      : null;

  if (typeof description !== "string") {
    return "";
  }

  // Tool descriptions are long; a preview is enough to choose one.
  return description.length > 220
    ? `${description.slice(0, 217)}...`
    : description;
}

/**
 * Escape hatch for context-scoped tool modes: the model can look up hidden
 * tools and enable the family they belong to. Enabling persists on the
 * conversation, so later turns keep the larger toolset.
 */
export function createToolDiscoveryTools(params: {
  getCatalog: () => ToolDiscoveryCatalog;
  /** Returns false when the family set does not fit the current context. */
  onEnableFamilies: (families: ToolFamily[]) => Promise<boolean> | boolean;
  onRecord?: (record: ToolExecutionRecord) => void;
}): { tools: ToolSet } {
  const hiddenTools = () => {
    const { all, active } = params.getCatalog();

    return Object.entries(all).filter(
      ([name]) => OPTIONAL_TOOL_NAMES.includes(name) && !(name in active),
    );
  };

  const findTools = tool({
    description:
      "Find tools that are hidden to save context. Call this when the task needs video/audio or document tools that are not in the current tool list, then call enableTools with the names you need. Read-only.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What you need to do, e.g. 'render video', 'split pdf', 'transcribe audio'. Omit to list everything hidden.",
        )
        .optional(),
    }),
    execute: async ({ query }) => {
      const inputSummary = summarizeValue({ query: query ?? null });
      const hidden = hiddenTools();
      const words = (query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 2);
      const matches = hidden
        .map(([name, definition]) => ({
          name,
          family: toolFamilyForName(name),
          description: describeTool(definition),
        }))
        .filter((entry) => {
          if (words.length === 0) {
            return true;
          }
          const haystack =
            `${entry.name} ${entry.family} ${entry.description}`.toLowerCase();
          return words.some((word) => haystack.includes(word));
        })
        .slice(0, MAX_FIND_RESULTS);
      const output = {
        tools: matches,
        hiddenFamilies: Array.from(
          new Set(hidden.map(([name]) => toolFamilyForName(name))),
        ).map((family) => TOOL_FAMILY_LABELS[family]),
        note:
          matches.length > 0
            ? "Call enableTools with the tool names you need. They stay enabled for the rest of this chat."
            : "No hidden tool matches. Continue with the tools already available.",
      };

      params.onRecord?.(
        createRecord({
          toolName: "findTools",
          status: "completed",
          inputSummary,
          outputSummary: summarizeValue({
            found: matches.map((entry) => entry.name),
          }),
          preview: {
            title: `${matches.length} tool${matches.length === 1 ? "" : "s"} found`,
            text: matches
              .map((entry) => `${entry.name} (${TOOL_FAMILY_LABELS[entry.family]})`)
              .join("\n"),
            truncated: false,
          },
        }),
      );

      return output;
    },
  });

  const enableTools = tool({
    description:
      "Enable hidden tools by name (use findTools first). Enabling a tool family also enables its sibling tools and persists for later turns in this chat.",
    inputSchema: z.object({
      names: z
        .array(z.string())
        .min(1)
        .describe("Exact tool names returned by findTools."),
    }),
    execute: async ({ names }) => {
      const inputSummary = summarizeValue({ names });
      const hiddenNames = new Set(hiddenTools().map(([name]) => name));
      const known = names.filter((name) => hiddenNames.has(name));
      const unknown = names.filter((name) => !hiddenNames.has(name));

      if (known.length === 0) {
        const output = {
          enabled: [] as string[],
          families: [] as string[],
          note:
            unknown.length > 0
              ? `Those tools are not hidden; they are either already available or do not exist: ${unknown.join(", ")}.`
              : "No tools were requested.",
        };
        params.onRecord?.(
          createRecord({
            toolName: "enableTools",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );
        return output;
      }

      const families = Array.from(
        new Set(known.map((name) => toolFamilyForName(name))),
      );
      const accepted = await params.onEnableFamilies(families);

      if (!accepted) {
        const output = {
          enabled: [] as string[],
          families: [] as string[],
          note:
            "There is not enough context window left to add those tools in this chat. Continue with the current toolset, or ask the user to switch to a model with a larger window.",
        };
        params.onRecord?.(
          createRecord({
            toolName: "enableTools",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );
        return output;
      }

      // Recompute from the updated catalog so callers see what is now visible.
      const active = params.getCatalog().active;
      const enabled = known.filter((name) => name in active);
      const output = {
        enabled,
        families: families.map((family) => TOOL_FAMILY_LABELS[family]),
        note:
          enabled.length > 0
            ? "Tools are available from your next step onward."
            : "The tools could not be enabled. Continue with the current toolset.",
        ...(unknown.length > 0
          ? { ignored: unknown }
          : {}),
      };

      params.onRecord?.(
        createRecord({
          toolName: "enableTools",
          status: "completed",
          inputSummary,
          outputSummary: summarizeValue({
            enabled,
            families: output.families,
          }),
          preview: {
            title: `${enabled.length} tool${enabled.length === 1 ? "" : "s"} enabled`,
            text: enabled.join("\n"),
            truncated: false,
          },
        }),
      );

      return output;
    },
  });

  return { tools: { findTools, enableTools } };
}

export function buildToolDiscoverySystemPrompt(): string {
  return [
    "Some tools are hidden to keep this conversation light. If a task needs video/audio or document tools that are not in your tool list, call findTools with what you need, then enableTools with the returned names.",
    "Do not claim a hidden tool is unavailable until findTools returns nothing.",
  ].join("\n");
}
