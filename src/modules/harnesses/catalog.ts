export type HarnessID = "opencode" | "antigravity";

export type HarnessDefinition = {
  id: HarnessID;
  label: string;
  /** Whether this adapter can auto-attach the phone MCP bridge. */
  phoneTools: boolean;
};

export const SUPPORTED_HARNESSES = [
  { id: "opencode", label: "OpenCode", phoneTools: true },
  { id: "antigravity", label: "Antigravity", phoneTools: false },
] as const satisfies readonly HarnessDefinition[];
