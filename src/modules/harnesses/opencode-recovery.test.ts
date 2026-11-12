import { describe, expect, it } from "vitest";
import type { SessionMessageInfo } from "@opencode/client";

import {
  openCodeConversationFailure,
  openCodeErrorMessage,
  openCodeExecutionFailure,
  openCodePromptReply,
  openCodeStalledAssistant,
} from "./opencode-recovery";

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>;

function assistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: "msg_1",
    type: "assistant",
    time: { created: 1, completed: 2 },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [],
    finish: "stop",
    ...overrides,
  } as Assistant;
}

describe("openCodeStalledAssistant", () => {
  it("detects a completed reasoning-only stop", () => {
    const message = assistant({
      content: [{ type: "reasoning", text: "I should call the tool." }],
    });
    expect(openCodeStalledAssistant([message])).toBe(message);
  });

  it("detects a completely empty completed stop", () => {
    const message = assistant();
    expect(openCodeStalledAssistant([message])).toBe(message);
  });

  it("accepts length and unknown stops", () => {
    for (const finish of ["length", "unknown"] as const) {
      const message = assistant({ finish });
      expect(openCodeStalledAssistant([message])).toBe(message);
    }
  });

  it("ignores visible text, tool calls, errors, and unfinished steps", () => {
    expect(
      openCodeStalledAssistant([
        assistant({ content: [{ type: "text", text: "Done." }] }),
      ]),
    ).toBeNull();
    expect(
      openCodeStalledAssistant([
        assistant({
          content: [
            {
              type: "tool",
              id: "tool_1",
              name: "read",
              state: {
                status: "completed",
                input: {},
                content: [{ type: "text", text: "ok" }],
              },
              time: { created: 1, completed: 2 },
            },
          ],
        }),
      ]),
    ).toBeNull();
    expect(
      openCodeStalledAssistant([
        assistant({ error: { type: "ProviderError", message: "boom" } }),
      ]),
    ).toBeNull();
    expect(
      openCodeStalledAssistant([assistant({ time: { created: 1 } })]),
    ).toBeNull();
  });

  it("does not recover a retrying assistant step", () => {
    expect(
      openCodeStalledAssistant([
        assistant({
          retry: {
            attempt: 1,
            at: 2,
            error: { type: "ProviderError", message: "rate limited" },
          },
        }),
      ]),
    ).toBeNull();
  });

  it("ignores tool-call and error finish reasons", () => {
    expect(
      openCodeStalledAssistant([assistant({ finish: "tool-calls" })]),
    ).toBeNull();
    expect(
      openCodeStalledAssistant([assistant({ finish: "error" })]),
    ).toBeNull();
    expect(
      openCodeStalledAssistant([assistant({ finish: "content-filter" })]),
    ).toBeNull();
  });

  it("only examines the final message", () => {
    const stalled = assistant();
    const user = {
      id: "msg_2",
      type: "user",
      time: { created: 3 },
      text: "Continue",
    } as SessionMessageInfo;
    expect(openCodeStalledAssistant([stalled, user])).toBeNull();
  });

  it("ignores trailing idle rows", () => {
    const stalled = assistant();
    const idle = {
      id: "msg_idle",
      type: "idle",
      time: { created: 3 },
      outcome: "succeeded",
    } as SessionMessageInfo;
    expect(openCodeStalledAssistant([stalled, idle])).toBe(stalled);
  });
});

describe("openCodeExecutionFailure", () => {
  it("reads a failed trailing idle row", () => {
    const message = {
      id: "msg_idle",
      type: "idle",
      time: { created: 3 },
      outcome: "failed",
      error: { type: "ProviderError", message: "provider rejected the turn" },
    } as SessionMessageInfo;
    expect(openCodeExecutionFailure([message])).toEqual({
      type: "ProviderError",
      message: "provider rejected the turn",
    });
  });

  it("ignores successful idle rows and newer conversation turns", () => {
    const success = {
      id: "msg_idle",
      type: "idle",
      time: { created: 3 },
      outcome: "succeeded",
    } as SessionMessageInfo;
    expect(openCodeExecutionFailure([success])).toBeNull();
    expect(openCodeExecutionFailure([success, assistant()])).toBeNull();
  });
});

describe("openCodeConversationFailure", () => {
  it("reads the assistant provider error", () => {
    expect(
      openCodeConversationFailure([
        assistant({
          error: {
            type: "ProviderError",
            message: "rate limit exceeded",
            status: 429,
          },
        }),
      ]),
    ).toEqual({
      type: "ProviderError",
      message: "rate limit exceeded",
      status: 429,
    });
  });

  it("falls back to a failed idle row", () => {
    const idle = {
      id: "msg_idle",
      type: "idle",
      time: { created: 3 },
      outcome: "failed",
      error: { type: "ExecutionFailed", message: "stopped" },
    } as SessionMessageInfo;
    expect(openCodeConversationFailure([idle])).toEqual({
      type: "ExecutionFailed",
      message: "stopped",
    });
  });

  it("ignores an error that belongs to an older turn", () => {
    const failed = assistant({
      error: { type: "ProviderError", message: "old" },
    });
    const nextUser = {
      id: "msg_user_2",
      type: "user",
      time: { created: 4 },
      text: "Try again",
    } as SessionMessageInfo;
    expect(openCodeConversationFailure([failed, nextUser])).toBeNull();
  });

  it("hides a failure while OpenCode is retrying it", () => {
    expect(
      openCodeConversationFailure([
        assistant({
          error: { type: "ProviderError", message: "rate limited" },
          retry: {
            attempt: 1,
            at: 3,
            error: { type: "ProviderError", message: "rate limited" },
          },
        }),
      ]),
    ).toBeNull();
  });
});

describe("openCodeErrorMessage", () => {
  it("turns rate limits into actionable text", () => {
    expect(
      openCodeErrorMessage({
        type: "ProviderError",
        message: "rate limit exceeded",
        status: 429,
        retryAfterMs: 6000,
      }),
    ).toContain("rate limit");
    expect(
      openCodeErrorMessage({
        type: "ProviderError",
        message: "rate limit exceeded",
        status: 429,
        retryAfterMs: 6000,
      }),
    ).toContain("Try again in 6s");
  });

  it("calls out authentication failures", () => {
    expect(
      openCodeErrorMessage({
        type: "ProviderError",
        message: "invalid api key",
        status: 401,
      }),
    ).toContain("Reconnect or check the harness credentials");
  });

  it("keeps the provider detail for ordinary failures", () => {
    expect(
      openCodeErrorMessage({
        type: "ProviderError",
        message: "model unavailable",
      }),
    ).toBe("OpenCode failed: model unavailable");
  });
});

describe("openCodePromptReply", () => {
  const user = {
    id: "msg_user",
    type: "user",
    time: { created: 1 },
    text: "Hello",
  } as SessionMessageInfo;

  it("waits until the prompt is visible", () => {
    expect(openCodePromptReply([], { userID: "msg_user" })).toEqual({
      state: "missing",
    });
    expect(openCodePromptReply([user], { userID: "msg_user" })).toEqual({
      state: "waiting",
    });
  });

  it("detects answers and stalls", () => {
    expect(
      openCodePromptReply(
        [user, assistant({ content: [{ type: "text", text: "Done." }] })],
        { userID: "msg_user" },
      ),
    ).toEqual({ state: "answered" });
    const stalled = assistant();
    expect(
      openCodePromptReply([user, stalled], { userID: "msg_user" }),
    ).toEqual({
      state: "stalled",
      assistant: stalled,
    });
  });

  it("treats an unfinished assistant step as waiting", () => {
    expect(
      openCodePromptReply([user, assistant({ time: { created: 2 } })], {
        userID: "msg_user",
      }),
    ).toEqual({ state: "waiting" });
  });

  it("falls back to the row before the prompt when the inbox ID differs", () => {
    const previous = assistant({ content: [{ type: "text", text: "Hello." }] });
    const next = {
      id: "msg_new_user",
      type: "user",
      time: { created: 3 },
      text: "Next",
    } as SessionMessageInfo;
    expect(
      openCodePromptReply(
        [
          previous,
          next,
          assistant({ id: "msg_new_assistant", time: { created: 4, completed: 5 } }),
        ],
        { userID: "inbox_id", previousMessageID: previous.id },
      ),
    ).toMatchObject({ state: "stalled" });
  });
});
