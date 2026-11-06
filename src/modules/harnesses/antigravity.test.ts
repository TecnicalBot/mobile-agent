import { describe, expect, it, vi } from "vitest";
import type {
  AcpNewSessionResult,
  AcpPermissionOption,
  AcpSessionConfigOption,
} from "./antigravity";
import { AntigravityClient, normalizeAntigravityUrl } from "./antigravity";
import {
  antigravityModels,
  antigravityModelSelection,
  antigravityModelRef,
  antigravityPermissionOption,
  applyAntigravityUpdate,
  beginAntigravityTurn,
  buildAntigravityContext,
  createAntigravitySessionState,
  detachAntigravityTurn,
  finishAntigravityTurn,
  presentAntigravityAgent,
  presentAntigravityConversation,
  presentAntigravityModel,
} from "./antigravity-presentation";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "test" } },
}));
vi.mock("expo/fetch", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) =>
    globalThis.fetch(...args),
}));

const CONFIG_OPTIONS: AcpSessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gemini-3.8-flash",
    options: [
      { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ],
  },
  {
    id: "thought_level",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

function sessionResult(): AcpNewSessionResult {
  return {
    sessionId: "sess_123",
    models: {
      availableModels: [
        { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
        { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      ],
      currentModelId: "gemini-3.8-flash-high",
    },
    modes: {
      currentModeId: "default",
      availableModes: [
        {
          id: "default",
          name: "Default",
          description: "Ask before edits",
        },
        { id: "plan", name: "Plan", description: "Plan first" },
      ],
    },
    configOptions: [
      ...CONFIG_OPTIONS,
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "plan", name: "Plan" },
        ],
      },
    ],
  };
}

describe("Antigravity bridge URLs", () => {
  it("accepts loopback HTTP and HTTPS", () => {
    expect(normalizeAntigravityUrl("http://127.0.0.1:7801")).toBe(
      "http://127.0.0.1:7801",
    );
    expect(normalizeAntigravityUrl("https://antigravity.example.com")).toBe(
      "https://antigravity.example.com",
    );
  });

  it("requires explicit consent for plain HTTP on a LAN address", () => {
    expect(() => normalizeAntigravityUrl("http://192.168.1.20:7801")).toThrow(
      /HTTPS/,
    );
    expect(
      normalizeAntigravityUrl("http://192.168.1.20:7801", {
        allowInsecureLan: true,
      }),
    ).toBe("http://192.168.1.20:7801");
  });

  it("rejects wildcard and credential URLs", () => {
    expect(() => normalizeAntigravityUrl("http://0.0.0.0:7801")).toThrow(
      /wildcard/,
    );
    expect(() =>
      normalizeAntigravityUrl("https://user:pass@example.com"),
    ).toThrow(/credentials/);
  });
});

describe("Antigravity model presentation", () => {
  it("namespaces model refs away from the direct runtime", () => {
    expect(antigravityModelRef("gemini-3.8-flash-high")).toBe(
      "harness:antigravity/gemini-3.8-flash-high",
    );
    expect(presentAntigravityModel({ modelId: "m", name: "Model" })).toMatchObject(
      {
        providerId: "harness:antigravity",
        providerLabel: "Antigravity (Harness)",
        supportsTools: true,
        supportsReasoning: true,
      },
    );
  });

  it("maps variant model IDs back to the model + thinking config options", () => {
    expect(
      antigravityModelSelection(
        { modelId: "gemini-3.8-flash-high", name: "High" },
        CONFIG_OPTIONS,
      ),
    ).toEqual({ modelValue: "gemini-3.8-flash", thoughtValue: "high" });
    expect(
      antigravityModelSelection(
        { modelId: "claude-sonnet-4-6", name: "Claude" },
        CONFIG_OPTIONS,
      ),
    ).toEqual({ modelValue: "claude-sonnet-4-6", thoughtValue: null });
  });

  it("falls back to config option values when variants are absent", () => {
    expect(antigravityModels({ configOptions: CONFIG_OPTIONS })).toEqual([
      { modelId: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ]);
  });
});

describe("Antigravity transcript updates", () => {
  it("streams text, reasoning, and tool output into one assistant turn", () => {
    let state = createAntigravitySessionState({
      result: sessionResult(),
      cwd: "/tmp/project",
    });
    state = beginAntigravityTurn(state, "Inspect this");
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      messageId: "m1",
      content: { type: "text", text: "Let me look." },
    });
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "Reading the file." },
    });
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read file",
      kind: "read",
      status: "pending",
      rawInput: { path: "/tmp/project/a.ts" },
      content: [
        {
          type: "content",
          content: { type: "text", text: "export const a = 1;" },
        },
      ],
    });
    // Updates that only rename or change status must not erase the visible
    // input or output.
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      title: "Read file again",
      status: "completed",
      content: [],
    });
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: " Done." },
    });
    state = finishAntigravityTurn(state, "end_turn");

    expect(state.running).toBe(false);
    expect(state.messages).toHaveLength(2);
    const assistant = state.messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("Reading the file. Done.");
    expect(assistant.status).toBe("completed");
    expect(assistant.metadata?.reasoning?.[0]).toMatchObject({
      text: "Let me look.",
      completedAt: expect.any(String),
    });
    expect(assistant.metadata?.toolExecutions?.[0]).toMatchObject({
      toolName: "Read file again",
      status: "completed",
      inputSummary: JSON.stringify({ path: "/tmp/project/a.ts" }),
      outputSummary: "export const a = 1;",
    });
    expect(assistant.metadata?.toolRunAnchors).toHaveLength(1);
  });

  it("keeps a detached turn in one assistant message", () => {
    let state = createAntigravitySessionState({
      result: sessionResult(),
      cwd: "/tmp/project",
    });
    state = beginAntigravityTurn(state, "Keep writing");
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Part one." },
    });
    state = detachAntigravityTurn(state);
    expect(state.running).toBe(false);
    expect(state.stopReason).toBe("detached");
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " Part two." },
    });
    state = finishAntigravityTurn(state, "end_turn");

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].content).toBe("Part one. Part two.");
  });

  it("updates titles from session_info_update", () => {
    let state = createAntigravitySessionState({
      result: sessionResult(),
      cwd: "/tmp/project",
    });
    state = applyAntigravityUpdate(state, {
      sessionUpdate: "session_info_update",
      title: "A better title",
    });
    expect(state.title).toBe("A better title");
    expect(presentAntigravityConversation(state)).toMatchObject({
      id: "sess_123",
      providerId: "harness:antigravity",
      title: "A better title",
    });
  });

  it("presents modes as app agents", () => {
    expect(
      presentAntigravityAgent({
        id: "plan",
        name: "Plan",
        description: "Plan first",
      }),
    ).toMatchObject({
      id: "plan",
      name: "Plan",
      mode: "primary",
      enabled: true,
      hidden: false,
    });
  });
});

describe("Antigravity permissions and detached context", () => {
  const options: AcpPermissionOption[] = [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "always", name: "Always", kind: "allow_always" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ];

  it("chooses the closest ACP permission option", () => {
    expect(antigravityPermissionOption(options, "once")?.optionId).toBe(
      "allow",
    );
    expect(antigravityPermissionOption(options, "always")?.optionId).toBe(
      "always",
    );
    expect(antigravityPermissionOption(options, "reject")?.optionId).toBe(
      "reject",
    );
  });

  it("sends only local messages the remote session has not seen", () => {
    let state = createAntigravitySessionState({
      result: sessionResult(),
      cwd: "/tmp/project",
    });
    state = beginAntigravityTurn(state, "first");
    state = finishAntigravityTurn(state, "end_turn");
    state = beginAntigravityTurn(state, "second");
    state = finishAntigravityTurn(state, "end_turn");
    const [firstUser, secondUser] = state.messages;
    const context = buildAntigravityContext(state.messages, [firstUser.id]);
    expect(context.ids).toEqual([secondUser.id]);
    expect(context.text).toContain("Antigravity harness was detached");
    expect(context.text).toContain("User: second");
    expect(context.text).not.toContain("User: first");
  });
});

describe("Antigravity ACP client", () => {
  it("resolves JSON-RPC requests from the SSE stream", async () => {
    const encoder = new TextEncoder();
    const streamState: {
      controller?: ReadableStreamDefaultController<Uint8Array>;
    } = {};
    const stream = new ReadableStream<Uint8Array>({
      start(next) {
        streamState.controller = next;
      },
    });
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/events")) {
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (url.endsWith("/rpc")) {
        const body = JSON.parse(String(init?.body)) as {
          id: string;
          method: string;
        };
        queueMicrotask(() => {
          streamState.controller?.enqueue(
            encoder.encode(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: { method: body.method, ok: true },
              })}\n\n`,
            ),
          );
        });
        return new Response(JSON.stringify({ accepted: true }), {
          status: 202,
        });
      }
      return new Response("not found", { status: 404 });
    });

    const client = new AntigravityClient(
      { url: "http://127.0.0.1:7801", token: "", cwd: "" },
      { transport: transport as typeof globalThis.fetch },
    );
    const started = client.start();
    streamState.controller?.enqueue(
      encoder.encode(`event: ready\ndata: {"service":"bridge"}\n\n`),
    );
    await started;
    await expect(client.request("test/method")).resolves.toEqual({
      method: "test/method",
      ok: true,
    });
    client.stop();
  });
});
