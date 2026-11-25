import type { BuiltInToolKey, ToolFamily } from "@/core/types/app-state";

/**
 * Built-in tool families. A conversation always exposes "core"; "media" and
 * "documents" are optional families layered on top.
 *
 * Every built-in tool name that is not listed here belongs to "core", which
 * keeps new tools available by default instead of silently hiding them.
 */
export const TOOL_FAMILIES: ToolFamily[] = ["core", "media", "documents"];

export const MEDIA_TOOL_NAMES = [
  "analyzeAudio",
  "exportEditorPackage",
  "getVideoFrame",
  "listVoices",
  "previewMix",
  "previewScene",
  "renderVideo",
  "textToSpeech",
  "transcribeAudio",
] as const;

export const DOCUMENT_TOOL_NAMES = [
  "createFile",
  "mergeDocuments",
  "mergePdfs",
  "splitDocument",
  "splitPdf",
  "updateDocument",
] as const;

export const TOOL_FAMILY_LABELS: Record<ToolFamily, string> = {
  core: "Core",
  media: "Video & audio",
  documents: "Documents",
};

const familyByToolName = new Map<string, ToolFamily>([
  ...MEDIA_TOOL_NAMES.map((name) => [name, "media"] as const),
  ...DOCUMENT_TOOL_NAMES.map((name) => [name, "documents"] as const),
]);

/** Tools that only exist once a family is enabled (used for discovery). */
export const OPTIONAL_TOOL_NAMES: string[] = [
  ...DOCUMENT_TOOL_NAMES,
  ...MEDIA_TOOL_NAMES,
];

export function toolFamilyForName(toolName: string): ToolFamily {
  return familyByToolName.get(toolName) ?? "core";
}

/** A skill that recommends only optional-capable built-ins unlocks its family. */
const BUILT_IN_KEY_TO_TOOL_FAMILY: Partial<Record<BuiltInToolKey, ToolFamily>> = {
  workspaceCreateFile: "documents",
  workspaceRenderVideo: "media",
};

export function toolFamilyForBuiltInKey(
  key: BuiltInToolKey,
): ToolFamily | null {
  return BUILT_IN_KEY_TO_TOOL_FAMILY[key] ?? null;
}

export function isToolFamily(value: unknown): value is ToolFamily {
  return (
    typeof value === "string" &&
    (TOOL_FAMILIES as string[]).includes(value)
  );
}

/**
 * Canonicalizes a persisted/incoming family list: drops unknown values,
 * removes duplicates, and guarantees "core" is present.
 */
export function normalizeToolFamilies(input: unknown): ToolFamily[] {
  const source = Array.isArray(input) ? input : [];
  const families: ToolFamily[] = ["core"];

  for (const value of source) {
    if (isToolFamily(value) && !families.includes(value)) {
      families.push(value);
    }
  }

  return families;
}

export function hasToolFamily(
  families: ToolFamily[],
  family: ToolFamily,
): boolean {
  return family === "core" || families.includes(family);
}

export function addToolFamily(
  families: ToolFamily[],
  family: ToolFamily,
): ToolFamily[] {
  return normalizeToolFamilies([...families, family]);
}

export function removeToolFamily(
  families: ToolFamily[],
  family: ToolFamily,
): ToolFamily[] {
  // "core" is not removable: it is the baseline toolset.
  if (family === "core") {
    return normalizeToolFamilies(families);
  }

  return normalizeToolFamilies(families.filter((item) => item !== family));
}

/**
 * Keeps only the tools whose family is enabled. Unknown tool names are core,
 * so MCP/plugin/management tools pass through untouched.
 */
export function filterToolsByFamilies<T extends Record<string, unknown>>(
  tools: T,
  families: ToolFamily[],
): Partial<T> {
  const enabled = normalizeToolFamilies(families);

  return Object.fromEntries(
    Object.entries(tools).filter(([name]) =>
      hasToolFamily(enabled, toolFamilyForName(name)),
    ),
  ) as Partial<T>;
}

/** Tools that exist in the full catalog but are hidden by the active modes. */
export function hiddenToolNames<T extends Record<string, unknown>>(
  allTools: T,
  families: ToolFamily[],
): string[] {
  const enabled = normalizeToolFamilies(families);

  return Object.keys(allTools).filter(
    (name) => !hasToolFamily(enabled, toolFamilyForName(name)),
  );
}

export function describeToolFamilies(families: ToolFamily[]): string {
  return normalizeToolFamilies(families)
    .map((family) => TOOL_FAMILY_LABELS[family])
    .join(" + ");
}

/**
 * The smallest useful toolset, used only when a tiny context window cannot
 * hold the full core catalog. Reads and writes still work; everything else
 * is shed to leave room for the conversation.
 */
export const ESSENTIAL_TOOL_NAMES: string[] = [
  "edit",
  "glob",
  "grep",
  "listFiles",
  "read",
  "viewFile",
  "write",
];

export function pickEssentialTools<T extends Record<string, unknown>>(
  tools: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) =>
      ESSENTIAL_TOOL_NAMES.includes(name),
    ),
  ) as Partial<T>;
}
