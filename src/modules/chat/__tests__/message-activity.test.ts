import { describe, expect, it } from "vitest";

import type { StoredMessage } from "@/core/types/app-state";
import { getMessageActivity } from "@/modules/chat/message-activity";

function assistant(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: "assistant",
    conversationId: "chat",
    role: "assistant",
    content: "",
    metadata: null,
    status: "streaming",
    error: null,
    sequence: 1,
    createdAt: "2026-11-21T10:00:00.000Z",
    updatedAt: "2026-11-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("message activity", () => {
  it("does not claim the model is thinking while it waits for a first token", () => {
    expect(getMessageActivity(assistant())).toEqual({
      kind: "waiting",
      label: "Waiting for response…",
    });
  });

  it("reports thinking only while a reasoning block is open", () => {
    expect(
      getMessageActivity(
        assistant({
          metadata: {
            reasoning: [
              {
                id: "thought",
                text: "Planning",
                textOffset: 0,
                startedAt: "2026-11-21T10:00:00.000Z",
                completedAt: null,
              },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "reasoning", reasoningId: "thought" });
  });

  it("stops reporting thinking once the answer is streaming", () => {
    expect(
      getMessageActivity(
        assistant({
          content: "Here is the answer",
          metadata: {
            reasoning: [
              {
                id: "thought",
                text: "Planning",
                textOffset: 0,
                startedAt: "2026-11-21T10:00:00.000Z",
                completedAt: "2026-11-21T10:00:01.000Z",
              },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "answering" });
  });

  it("hides the loader only while the writer confirms text is streaming", () => {
    expect(
      getMessageActivity(
        assistant({
          content: "Here is the answer",
          metadata: { streamingText: true },
        }),
      ),
    ).toEqual({ kind: "answering" });
  });

  it("keeps the loader when trailing text is no longer streaming", () => {
    // The step finished writing text but the run is still busy (next step,
    // tool input, compaction). Before this flag the trailing text silently
    // suppressed every activity indicator.
    expect(
      getMessageActivity(
        assistant({
          content: "Here is the answer",
          metadata: { streamingText: false },
        }),
      ),
    ).toEqual({ kind: "waiting", label: "Waiting for response…" });
  });

  it("shows the loader when a run resumes after a completed text step", () => {
    expect(
      getMessageActivity(
        assistant({
          content: "Here is the answer",
          metadata: { streamingText: false },
          status: "streaming",
        }),
        "running",
      ),
    ).toEqual({ kind: "waiting", label: "Waiting for response…" });
  });

  it("prioritizes a running tool over a stale open reasoning block", () => {
    expect(
      getMessageActivity(
        assistant({
          metadata: {
            reasoning: [
              {
                id: "thought",
                text: "Planning",
                textOffset: 0,
                startedAt: "2026-11-21T10:00:00.000Z",
                completedAt: null,
              },
            ],
            toolExecutions: [
              {
                id: "tool",
                toolName: "renderVideo",
                status: "running",
                inputSummary: "{}",
                outputSummary: null,
                error: null,
                createdAt: "2026-11-21T10:00:02.000Z",
              },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "tools" });
  });

  it("shows approval and question waits instead of thinking", () => {
    expect(getMessageActivity(assistant(), "waiting_for_approval")).toEqual({
      kind: "waiting",
      label: "Waiting for approval",
    });
    expect(getMessageActivity(assistant(), "waiting_for_question")).toEqual({
      kind: "waiting",
      label: "Waiting for your response",
    });
  });

  it("is idle for completed messages", () => {
    expect(getMessageActivity(assistant({ status: "completed" }))).toEqual({
      kind: "idle",
    });
  });
});
