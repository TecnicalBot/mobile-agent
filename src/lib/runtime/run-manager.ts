import type {
  AgentRun,
  AgentRunStatus,
  PendingToolApproval,
  PendingToolApprovalRequest,
} from "@/types/app-state";

export type ToolApprovalDecision = "approve" | "deny" | "abort";

export const ACTIVE_AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "queued",
  "running",
  "waiting_for_approval",
  "resumable",
];

export function isActiveAgentRunStatus(status: AgentRunStatus) {
  return ACTIVE_AGENT_RUN_STATUSES.includes(status);
}

export function shouldAutoResumeRun(status: AgentRunStatus) {
  return status === "queued" || status === "resumable";
}

export function buildRunStatusByConversation(
  runs: AgentRun[],
): Record<string, AgentRunStatus | null> {
  const sortedRuns = [...runs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const nextMap: Record<string, AgentRunStatus | null> = {};

  for (const run of sortedRuns) {
    if (nextMap[run.conversationId] !== undefined) {
      continue;
    }

    nextMap[run.conversationId] = isActiveAgentRunStatus(run.status)
      ? run.status
      : null;
  }

  return nextMap;
}

export function createPendingToolApproval(
  run: AgentRun,
  chatTitle: string,
  request: PendingToolApprovalRequest,
): PendingToolApproval {
  return {
    ...request,
    chatTitle,
    conversationId: run.conversationId,
    runId: run.id,
  };
}

export function createRunControllerRegistry() {
  const abortControllers = new Map<string, AbortController>();
  const approvalResolvers = new Map<
    string,
    (decision: ToolApprovalDecision) => void
  >();

  return {
    clear(runId: string) {
      abortControllers.delete(runId);
      approvalResolvers.delete(runId);
    },
    getAbortController(runId: string) {
      return abortControllers.get(runId) ?? null;
    },
    registerAbortController(runId: string, controller: AbortController) {
      abortControllers.set(runId, controller);
    },
    registerPendingApproval(
      runId: string,
      resolver: (decision: ToolApprovalDecision) => void,
    ) {
      approvalResolvers.set(runId, resolver);
    },
    resolvePendingApproval(runId: string, decision: ToolApprovalDecision) {
      const resolver = approvalResolvers.get(runId) ?? null;

      approvalResolvers.delete(runId);
      resolver?.(decision);
    },
    stopRun(runId: string) {
      abortControllers.get(runId)?.abort();
      this.resolvePendingApproval(runId, "abort");
      abortControllers.delete(runId);
    },
  };
}
