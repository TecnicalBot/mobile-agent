import type {
  AgentRun,
  AgentRunStatus,
  PendingQuestionnaire,
  PendingQuestionnaireAnswer,
  PendingQuestionnaireRequest,
  PendingToolApproval,
  PendingToolApprovalRequest,
} from "@/core/types/app-state";

export type ToolApprovalDecision = "approve" | "deny" | "abort";

export const ACTIVE_AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "queued",
  "running",
  "waiting_for_approval",
  "waiting_for_question",
  "resumable",
  "retrying",
];

export function isActiveAgentRunStatus(status: AgentRunStatus) {
  return ACTIVE_AGENT_RUN_STATUSES.includes(status);
}

export function shouldAutoResumeRun(status: AgentRunStatus) {
  return status === "queued" || status === "resumable" || status === "retrying";
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

export function createPendingQuestionnaire(
  run: AgentRun,
  chatTitle: string,
  request: PendingQuestionnaireRequest,
): PendingQuestionnaire {
  return {
    ...request,
    chatTitle,
    conversationId: run.conversationId,
    runId: run.id,
  };
}

export function createRunControllerRegistry() {
  const abortControllers = new Map<string, AbortController>();
  const claimedRuns = new Set<string>();
  const canceledRuns = new Set<string>();
  const approvalResolvers = new Map<
    string,
    Map<string, (decision: ToolApprovalDecision) => void>
  >();
  const questionnaireResolvers = new Map<
    string,
    Map<string, (answers: PendingQuestionnaireAnswer[] | null) => void>
  >();

  return {
    version: 3 as number,
    clear(runId: string) {
      abortControllers.delete(runId);
      approvalResolvers.delete(runId);
      questionnaireResolvers.delete(runId);
      claimedRuns.delete(runId);
      canceledRuns.delete(runId);
    },
    claim(runId: string) {
      if (claimedRuns.has(runId)) return false;
      claimedRuns.add(runId);
      return true;
    },
    owns(runId: string) {
      return claimedRuns.has(runId);
    },
    getAbortController(runId: string) {
      return abortControllers.get(runId) ?? null;
    },
    registerAbortController(runId: string, controller: AbortController) {
      abortControllers.set(runId, controller);
      if (canceledRuns.has(runId)) controller.abort();
    },
    registerPendingApproval(
      runId: string,
      approvalId: string,
      resolver: (decision: ToolApprovalDecision) => void,
    ) {
      const runApprovals = approvalResolvers.get(runId) ?? new Map();
      runApprovals.set(approvalId, resolver);
      approvalResolvers.set(runId, runApprovals);
    },
    resolvePendingApproval(
      runId: string,
      approvalId: string,
      decision: ToolApprovalDecision,
    ) {
      const runApprovals = approvalResolvers.get(runId);
      const resolver = runApprovals?.get(approvalId) ?? null;

      runApprovals?.delete(approvalId);
      if (runApprovals?.size === 0) approvalResolvers.delete(runId);
      resolver?.(decision);
    },
    registerPendingQuestionnaire(
      runId: string,
      questionnaireId: string,
      resolver: (answers: PendingQuestionnaireAnswer[] | null) => void,
    ) {
      const runQuestionnaires =
        questionnaireResolvers.get(runId) ?? new Map();
      runQuestionnaires.set(questionnaireId, resolver);
      questionnaireResolvers.set(runId, runQuestionnaires);
    },
    resolvePendingQuestionnaire(
      runId: string,
      questionnaireId: string,
      answers: PendingQuestionnaireAnswer[] | null,
    ) {
      const runQuestionnaires = questionnaireResolvers.get(runId);
      const resolver = runQuestionnaires?.get(questionnaireId) ?? null;

      runQuestionnaires?.delete(questionnaireId);
      if (runQuestionnaires?.size === 0) {
        questionnaireResolvers.delete(runId);
      }
      resolver?.(answers);
    },
    stopRun(runId: string) {
      const controller = abortControllers.get(runId);
      if (controller || claimedRuns.has(runId)) canceledRuns.add(runId);
      controller?.abort();
      const runApprovals = approvalResolvers.get(runId);
      approvalResolvers.delete(runId);
      runApprovals?.forEach((resolve) => resolve("abort"));
      const runQuestionnaires = questionnaireResolvers.get(runId);
      questionnaireResolvers.delete(runId);
      runQuestionnaires?.forEach((resolve) => resolve(null));
      return Boolean(controller) || claimedRuns.has(runId);
    },
  };
}
