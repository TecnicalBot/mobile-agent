import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateViaAISDK, generateViaAISDKNonStreaming } from "./ai-sdk-runtime";
import type { GenerateModelTextStreamParams } from "./types";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), generate: vi.fn() }));
vi.mock("ai", () => ({ streamText: mocks.stream, generateText: mocks.generate }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const mediaResult = { type: "tool-result", toolCallId: "render-1", toolName: "renderVideo", output: { fileId: "mp4" } };
function usage(tokens = 1) {
  return {
    inputTokens: tokens, outputTokens: tokens, totalTokens: tokens * 2,
    inputTokenDetails: { noCacheTokens: tokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: tokens, reasoningTokens: 0 },
  };
}
function step(text: string, toolResults: unknown[] = [], finishReason = "stop", files: unknown[] = []) {
  return { text, toolResults, finishReason, files, usage: usage() };
}
function response(text: string, steps: ReturnType<typeof step>[]) {
  return {
    text, steps, files: steps.at(-1)?.files ?? [], toolResults: steps.at(-1)?.toolResults ?? [],
    responseMessages: [{ role: "tool", content: [mediaResult] }], totalUsage: usage(),
    textStream: (async function* () { if (text) yield text; })(),
  };
}
/** A finished turn with an assistant reply and no tool follow-up pending. */
function assistantResponse(text: string) {
  return {
    ...response(text, [step(text)]),
    responseMessages: [{ role: "assistant", content: text }],
  };
}
function params(extra: Partial<GenerateModelTextStreamParams> = {}): GenerateModelTextStreamParams {
  return { model: { transport: "openaiCompatible" }, messages: [], maxToolSteps: 20, ...extra } as GenerateModelTextStreamParams;
}

describe.each(["streaming", "non-streaming"])("tool follow-up recovery (%s)", (mode) => {
  const run = (p = params()) => mode === "streaming"
    ? generateViaAISDK("model" as never, p)
    : generateViaAISDKNonStreaming("model" as never, p);
  const mock = mode === "streaming" ? mocks.stream : mocks.generate;
  beforeEach(() => vi.resetAllMocks());

  it("continues after progress text plus tool execution and preserves prior outputs", async () => {
    const file = { mediaType: "image/png", uint8Array: new Uint8Array([1]) };
    mock.mockReturnValueOnce(response("Preparing.\n", [step("Preparing.\n", [mediaResult], "tool-calls", [file])]))
      .mockReturnValueOnce(response("Done: workspace://mp4", [step("Done: workspace://mp4")]));
    const onDelta = vi.fn();
    const result = await run(params({ onDelta }));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0].stopWhen({ steps: Array(18) })).toBe(false);
    expect(mock.mock.calls[1][0].stopWhen({ steps: Array(19) })).toBe(true);
    expect(mock.mock.calls[1][0].messages.at(-1).content).toContain("do not repeat completed actions");
    expect(result.text).toBe("Preparing.\nDone: workspace://mp4");
    expect(result.toolResults).toEqual([mediaResult]);
    expect(result.generatedFiles).toEqual([file]);
    expect(result.usage?.totalTokens).toBe(4);
    expect(onDelta.mock.calls.map(([text]) => text).join("")).toBe(result.text);
  });

  it("recovers a blank final step despite earlier progress commentary", async () => {
    mock.mockReturnValueOnce(response("Preparing.", [step("Preparing.", [mediaResult]), step("")]))
      .mockReturnValueOnce(response("Done.", [step("Done.")]));
    expect((await run()).text).toBe("Preparing.Done.");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a completed run with a real post-tool final reply", async () => {
    mock.mockReturnValueOnce(response("Done.", [step("", [mediaResult], "tool-calls"), step("Done.")]));
    const result = await run();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.toolResults).toEqual([mediaResult]);
  });

  it("does not recover a text-only answer or a tool-step safety limit", async () => {
    mock.mockReturnValueOnce(response("Hello", [step("Hello")]));
    await run();
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockReturnValueOnce(response("Working", [step("Working", [mediaResult], "tool-calls")]));
    expect((await run(params({ maxToolSteps: 1 }))).stepLimitReached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("bounds recovery and reports failure instead of a false success", async () => {
    mock.mockImplementation(() => response("Working.", [step("Working.", [mediaResult], "tool-calls")]));
    await expect(run()).rejects.toThrow("two recovery attempts");
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does not recover after cancellation even if the SDK returns partial text", async () => {
    const controller = new AbortController();
    controller.abort();
    mock.mockReturnValueOnce(response("Working", [step("Working", [mediaResult])]));
    await expect(run(params({ abortSignal: controller.signal }))).rejects.toThrow("aborted");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe.each(["streaming", "non-streaming"])("context management (%s)", (mode) => {
  const run = (p: GenerateModelTextStreamParams) => mode === "streaming"
    ? generateViaAISDK("model" as never, p)
    : generateViaAISDKNonStreaming("model" as never, p);
  const mock = mode === "streaming" ? mocks.stream : mocks.generate;
  beforeEach(() => vi.resetAllMocks());

  it("keeps the final step's context usage separate from billing totals", async () => {
    mock.mockReturnValueOnce({
      ...response("Done.", [step("tool", [mediaResult]), { ...step("Done."), usage: usage(21_000) }]),
      totalUsage: usage(173_500),
    });
    const result = await run(params());
    expect(result.usage?.totalTokens).toBe(347_000);
    expect(result.contextUsage?.totalTokens).toBe(42_000);
  });

  it("uses the final continuation's context usage, not a sum", async () => {
    mock.mockReturnValueOnce(response("Working.", [step("Working.", [mediaResult], "tool-calls")]))
      .mockReturnValueOnce({ ...response("Done.", [{ ...step("Done."), usage: usage(10) }]), totalUsage: usage(10) });
    const result = await run(params());
    expect(result.usage?.totalTokens).toBe(22);
    expect(result.contextUsage?.totalTokens).toBe(20);
  });

  it("checks context on every step, including initial and steered requests", async () => {
    mock.mockReturnValueOnce(assistantResponse("Done."));
    const prepareMessages = vi.fn(async (messages) => messages.slice(-1));
    const steer = { role: "user", content: "new guidance" };
    const takeSteeredUserInput = vi.fn().mockReturnValue([]);
    await run(params({ prepareMessages, takeSteeredUserInput }));
    const hook = mock.mock.calls[0][0].prepareStep;
    const messages = [{ role: "user", content: "old history" }, { role: "user", content: "current" }];
    expect((await hook({ stepNumber: 0, messages })).messages).toEqual([messages[1]]);
    takeSteeredUserInput.mockReturnValueOnce([steer]);
    expect((await hook({ stepNumber: 1, messages })).messages).toEqual([steer]);
    await hook({ stepNumber: 2, messages });
    expect(prepareMessages).toHaveBeenCalledTimes(3);
    expect(prepareMessages.mock.calls[1][0]).toEqual([...messages, steer]);
  });

  it("checks context again for manual continuation calls", async () => {
    const prepareMessages = vi.fn(async (messages) => messages);
    mock.mockReturnValueOnce(response("Working.", [step("Working.", [mediaResult], "tool-calls")]))
      .mockReturnValueOnce(assistantResponse("Done."));
    await run(params({ prepareMessages }));
    expect(mock.mock.calls[1][0].prepareStep).toBeTypeOf("function");
    const messages = mock.mock.calls[1][0].messages;
    await mock.mock.calls[1][0].prepareStep({ stepNumber: 0, messages });
    expect(prepareMessages).toHaveBeenCalledWith(messages);
  });
});

describe.each(["streaming", "non-streaming"])("steered input (%s)", (mode) => {
  const run = (p: GenerateModelTextStreamParams) => mode === "streaming"
    ? generateViaAISDK("model" as never, p)
    : generateViaAISDKNonStreaming("model" as never, p);
  const mock = mode === "streaming" ? mocks.stream : mocks.generate;
  beforeEach(() => vi.resetAllMocks());

  it("wires no prepareStep hook when there is no steer drain", async () => {
    mock.mockReturnValueOnce(response("Done.", [step("Done.")]));
    await run(params());
    expect(mock.mock.calls[0][0].prepareStep).toBeUndefined();
  });

  it("promotes drained steers at the next step boundary, never before step 1", async () => {
    const steer = { role: "user", content: "[Steered input] do Y instead" };
    const takeSteeredUserInput = vi.fn().mockReturnValueOnce([]);
    mock.mockReturnValueOnce(response("Done.", [step("Done.")]));
    await run(params({ takeSteeredUserInput }));

    // The post-run late check drained once (nothing pending, so no extra
    // call); clear history so the assertions below observe only the
    // prepareStep invocations driven manually.
    expect(takeSteeredUserInput).toHaveBeenCalledTimes(1);
    takeSteeredUserInput.mockClear();
    takeSteeredUserInput.mockReturnValueOnce([steer]).mockReturnValueOnce([]);

    const options = mock.mock.calls[0][0];
    expect(options.prepareStep).toBeTypeOf("function");

    // Step 0 is the original turn — the drain must not run before it.
    const original = [{ role: "user", content: "orig" }];
    expect(await options.prepareStep({ stepNumber: 0, messages: original })).toBeUndefined();
    expect(takeSteeredUserInput).not.toHaveBeenCalled();

    // First safe boundary: the drained steer joins the loop's message state
    // and the drain sees which step it landed on.
    const boundary = await options.prepareStep({ stepNumber: 1, messages: original });
    expect(takeSteeredUserInput).toHaveBeenCalledWith(1);
    expect(boundary.messages).toEqual([original[0], steer]);

    // Nothing pending → no override, so the SDK keeps its own state.
    expect(await options.prepareStep({ stepNumber: 2, messages: boundary.messages })).toBeUndefined();
  });

  it("restarts the step budget from the promotion point", async () => {
    let budgetBase = 0;
    mock.mockReturnValueOnce(response("Working", [step("Working")]));
    await run(params({
      maxToolSteps: 3,
      getStepBudgetBase: () => budgetBase,
    }));

    const { stopWhen } = mock.mock.calls[0][0];
    // Fresh budget of 3 steps: stop on the third.
    expect(stopWhen({ steps: Array(2) })).toBe(false);
    expect(stopWhen({ steps: Array(3) })).toBe(true);
    // A steer promoted at step 2 opens a fresh window (opencode parity):
    // 2 completed + 3 fresh = stop only on the 5th step.
    budgetBase = 2;
    expect(stopWhen({ steps: Array(4) })).toBe(false);
    expect(stopWhen({ steps: Array(5) })).toBe(true);
  });

  it("delivers a steer that arrived during the final step inside the same run", async () => {
    const steer = { role: "user", content: "[Steered input] prefer blue" };
    const takeSteeredUserInput = vi.fn()
      .mockReturnValueOnce([steer])
      .mockReturnValueOnce([]);
    mock
      .mockReturnValueOnce(assistantResponse("First answer."))
      .mockReturnValueOnce(assistantResponse("Blue it is."));

    const result = await run(params({ takeSteeredUserInput }));

    // The tool-less SDK loop would have ended after call 1, stranding the
    // steer as a later turn; the manual continuation keeps it in-run.
    expect(mock).toHaveBeenCalledTimes(2);
    expect(takeSteeredUserInput).toHaveBeenCalledWith(0);
    const secondMessages = mock.mock.calls[1][0].messages;
    expect(secondMessages.at(-2)).toEqual({
      role: "assistant",
      content: "First answer.",
    });
    expect(secondMessages.at(-1)).toEqual(steer);
    expect(result.text).toBe("First answer.Blue it is.");
  });

  it("does not spend an extra model call when nothing was steered", async () => {
    const takeSteeredUserInput = vi.fn().mockReturnValue([]);
    mock.mockReturnValueOnce(assistantResponse("Done."));

    const result = await run(params({ takeSteeredUserInput }));

    expect(mock).toHaveBeenCalledTimes(1);
    expect(takeSteeredUserInput).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("Done.");
  });

  it("bounds late-steer continuations so repeated input cannot loop forever", async () => {
    mock.mockImplementation(() => assistantResponse("ok"));
    const takeSteeredUserInput = vi
      .fn()
      .mockReturnValue([{ role: "user", content: "again" }]);

    await run(params({ takeSteeredUserInput }));

    // 1 initial call + MAX_LATE_STEER_CONTINUATIONS (8); leftovers fall
    // through to after-run promotion instead of chaining model calls.
    expect(mock.mock.calls.length).toBe(9);
    expect(takeSteeredUserInput).toHaveBeenCalledTimes(8);
  });

  it("does not deliver steers after abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const takeSteeredUserInput = vi
      .fn()
      .mockReturnValue([{ role: "user", content: "x" }]);
    mock.mockReturnValueOnce(assistantResponse("partial"));

    await expect(
      run(params({ abortSignal: controller.signal, takeSteeredUserInput })),
    ).rejects.toThrow("aborted");
    expect(takeSteeredUserInput).not.toHaveBeenCalled();
  });
});
