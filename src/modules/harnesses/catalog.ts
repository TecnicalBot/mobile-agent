export type HarnessID = "opencode" | "antigravity" | "claude";

export type HarnessDefinition = {
  id: HarnessID;
  label: string;
  /** Whether this adapter can auto-attach the phone MCP bridge. */
  phoneTools: boolean;
  /** Shown when the host agent needs a one-time sign-in. */
  signInHint?: string;
  /** Short description for the settings list. */
  description: string;
};

export const SUPPORTED_HARNESSES = [
  {
    id: "opencode",
    label: "OpenCode",
    phoneTools: true,
    description: "Host harness with device sharing",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    phoneTools: true,
    description: "Google Antigravity over an ACP bridge",
    signInHint:
      "Run `agy acp --login` on the computer running the bridge, then tap Refresh. The app never stores Antigravity credentials.",
  },
  {
    id: "claude",
    label: "Claude",
    phoneTools: true,
    description: "Claude Code over an ACP bridge",
    signInHint:
      "Run `claude auth login` on the computer running the bridge to use a Claude subscription (or set ANTHROPIC_API_KEY), then tap Refresh. The app never stores Claude credentials.",
  },
] as const satisfies readonly HarnessDefinition[];
