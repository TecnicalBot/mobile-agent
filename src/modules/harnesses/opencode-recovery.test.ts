import { describe, expect, it } from "vitest";
import type { SessionMessageInfo } from "@opencode/client";

import { openCodeStalledAssistant } from "./opencode-recovery";

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
});
