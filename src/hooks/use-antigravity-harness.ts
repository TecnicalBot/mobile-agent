import { useAcpHarnessController } from "./use-acp-harness";
import { ANTIGRAVITY_PROFILE } from "@/modules/harnesses/acp-profile";

export function useAntigravityHarnessController() {
  return useAcpHarnessController(ANTIGRAVITY_PROFILE);
}

export type AntigravityHarnessController = ReturnType<
  typeof useAntigravityHarnessController
>;
