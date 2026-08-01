import type { Dispatch, SetStateAction } from "react";

import { appendChatRenderError } from "@/core/services/chat-diagnostics";
import type {
  AppStateSnapshot,
  PendingToolApproval,
} from "@/core/types/app-state";

export const UI_PROJECTION_BLACKOUT_THRESHOLD = 3;

export function isUiProjectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /maximum update depth|too many re-renders|too many rerenders/i.test(
    error.message,
  );
}

export type RunUiPublisher = {
  publishSnapshot: (
    updater: (current: AppStateSnapshot) => AppStateSnapshot,
    options?: { force?: boolean },
  ) => void;
  publishError: (message: string) => void;
  publishApprovals: (
    updater: (current: PendingToolApproval[]) => PendingToolApproval[],
  ) => void;
};

export function createRunUiPublisher(input: {
  runId: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setPendingToolApprovals: Dispatch<SetStateAction<PendingToolApproval[]>>;
  setSnapshot: Dispatch<SetStateAction<AppStateSnapshot>>;
}): RunUiPublisher {
  let streamingProjectionFailures = 0;
  let blackedOut = false;

  const reportProjectionFailure = (context: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : null;
    void appendChatRenderError({
      context,
      message,
      runId: input.runId,
      stack,
    });
  };

  const publishSnapshot: RunUiPublisher["publishSnapshot"] = (
    updater,
    options,
  ) => {
    if (blackedOut && !options?.force) {
      return;
    }

    try {
      input.setSnapshot(updater);
      streamingProjectionFailures = 0;
    } catch (error) {
      reportProjectionFailure("snapshot", error);
      if (!options?.force && isUiProjectionFailure(error)) {
        streamingProjectionFailures += 1;
        if (streamingProjectionFailures >= UI_PROJECTION_BLACKOUT_THRESHOLD) {
          blackedOut = true;
        }
      }
    }
  };

  const publishError: RunUiPublisher["publishError"] = (message) => {
    try {
      input.setError(message);
    } catch (error) {
      reportProjectionFailure("error", error);
    }
  };

  const publishApprovals: RunUiPublisher["publishApprovals"] = (updater) => {
    try {
      input.setPendingToolApprovals(updater);
    } catch (error) {
      reportProjectionFailure("pending-approvals", error);
    }
  };

  return { publishApprovals, publishError, publishSnapshot };
}
