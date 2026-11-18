/**
 * "viewFile" → "View File", "fetch_page" → "Fetch Page".
 *
 * Kept separate from `tool-label.ts` so non-UI modules (tool preview builders,
 * record creation) can format a tool name without pulling in icon imports.
 */
export function formatToolName(toolName: string) {
  if (!toolName) {
    return "Tool";
  }

  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
