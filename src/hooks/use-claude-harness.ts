import { useAcpHarnessController } from "./use-acp-harness";
import { CLAUDE_PROFILE } from "@/modules/harnesses/acp-profile";

export function useClaudeHarnessController() {
  return useAcpHarnessController(CLAUDE_PROFILE);
}

export type ClaudeHarnessController = ReturnType<
  typeof useClaudeHarnessController
>;
