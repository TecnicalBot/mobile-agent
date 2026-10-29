export type HarnessDefinition = {
  id: "opencode";
  label: string;
  /** Whether this adapter can auto-attach the phone MCP bridge. */
  phoneTools: boolean;
};

export const SUPPORTED_HARNESSES = [
  { id: "opencode", label: "OpenCode", phoneTools: true },
] as const satisfies readonly HarnessDefinition[];
