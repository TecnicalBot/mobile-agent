import type { ModelRef } from "@/core/types/app-state";

export type AcpHarnessID = "antigravity" | "claude";

/**
 * The parts of an ACP harness that differ between agents. The transport,
 * transcript presentation, and session lifecycle are shared.
 */
export type AcpHarnessProfile = {
  id: AcpHarnessID;
  /** Display name used in chat titles, errors, and settings. */
  label: string;
  /** model_ref namespace, for example `harness:claude`. */
  providerId: string;
  /** Prefix for model refs, including the trailing slash. */
  modelPrefix: string;
  /** SecureStore key holding the bridge connection. */
  storageKey: string;
  /** Default bridge port when no saved connection exists. */
  defaultPort: number;
  /** Directory under `tools/` that contains the bridge launcher. */
  bridgeDirectory: string;
  /** Hint shown when the host agent is not signed in. */
  signInHint: string;
  /** Documentation shown in the connection form. */
  bridgeHint: string;
};

export function acpModelRef(
  profile: AcpHarnessProfile,
  modelId: string,
): ModelRef {
  return `${profile.modelPrefix}${encodeURIComponent(modelId)}` as ModelRef;
}

/**
 * Messages that mean the host agent is signed out. The word boundaries matter:
 * `Unauthorized` is a bridge-token failure, not an agent login failure.
 */
export const ACP_AUTH_ERROR_PATTERN =
  /\b(auth|authentication|authenticate|auth.?required|sign(?:ed)?[ ._-]?in|log(?:ged)?[ ._-]?in|api.?key|credential|-32000)\b/i;

export const ANTIGRAVITY_PROFILE = {
  id: "antigravity",
  label: "Antigravity",
  providerId: "harness:antigravity",
  modelPrefix: "harness:antigravity/",
  storageKey: "antigravity_harness_connection_v1",
  defaultPort: 7801,
  bridgeDirectory: "antigravity-bridge",
  signInHint:
    "Antigravity is not signed in on the bridge host. Run `agy acp --login` on the computer running the bridge, then tap Refresh.",
  bridgeHint:
    "Sign in once with `agy acp --login`, then start the bridge:",
} as const satisfies AcpHarnessProfile;

export const CLAUDE_PROFILE = {
  id: "claude",
  label: "Claude",
  providerId: "harness:claude",
  modelPrefix: "harness:claude/",
  storageKey: "claude_harness_connection_v1",
  defaultPort: 7802,
  bridgeDirectory: "claude-bridge",
  signInHint:
    "Claude is not signed in on the bridge host. Run `claude auth login` for a Claude subscription (or set ANTHROPIC_API_KEY) on the computer running the bridge, then tap Refresh.",
  bridgeHint:
    "Sign in with `claude auth login` to use a Claude subscription, or set `ANTHROPIC_API_KEY`, then start the bridge:",
} as const satisfies AcpHarnessProfile;

export const ACP_PROFILES = [ANTIGRAVITY_PROFILE, CLAUDE_PROFILE] as const;
