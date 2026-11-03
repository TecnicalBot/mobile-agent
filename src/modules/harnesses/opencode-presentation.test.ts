import { describe, expect, it } from "vitest";
import type {
  AgentInfo,
  FormInfo,
  ModelInfo,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client";
import {
  openCodeFormAnswer,
  openCodeModelRef,
  presentOpenCodeConversation,
  presentOpenCodeAgent,
  presentOpenCodeMessages,
  presentOpenCodeModel,
  presentOpenCodeQuestionnaire,
} from "./opencode-presentation";

describe("OpenCode shared chat presentation", () => {
  it("presents actual harness agents without importing their execution configuration", () => {
    const agent: AgentInfo = {
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews code",
      mode: "primary",
      hidden: false,
      system: "Remote-only prompt",
      permissions: [],
      request: { settings: {}, headers: {}, body: {} },
      model: { id: "model", providerID: "provider" },
    };
    expect(presentOpenCodeAgent(agent)).toMatchObject({
      id: "reviewer",
      name: "Reviewer",
      mode: "primary",
      enabled: true,
      hidden: false,
      prompt: null,
      toolPermissions: {},
      modelModelId: "model",
    });
    expect(
      presentOpenCodeAgent({ ...agent, mode: "subagent", hidden: true }),
    ).toMatchObject({ mode: "subagent", hidden: true });
  });

  it("keeps the real session agent separate from its harness name", () => {
    const session = {
      id: "ses_plan",
      agent: "plan",
      time: { created: 1, updated: 2 },
    } as SessionInfo;
    expect(presentOpenCodeConversation(session)).toMatchObject({
      agentId: "plan",
      agentMode: "plan",
    });
  });
  it("namespaces models so they cannot enter the direct-provider runtime", () => {
    const model = {
      id: "model/name",
      providerID: "provider",
      name: "Test model",
      enabled: true,
      capabilities: {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      },
      cost: [{ input: 0, output: 0 }],
      limit: { context: 1000 },
    } as ModelInfo;
    expect(openCodeModelRef(model)).toBe(
      "harness:opencode/provider/model%2Fname",
    );
    const result = presentOpenCodeModel(model);
    expect(result.providerId).toBe("harness:opencode");
    expect(result.providerLabel).toBe("OpenCode (Harness)");
    expect(result.isFree).toBe(true);
    expect(result.supportsTools).toBe(true);
    expect(result.supportsImageInput).toBe(true);
    expect(result.supportsAudioInput).toBe(false);
    expect(result.supportsVideoInput).toBe(false);
  });

  it("treats a model without capability metadata as text-only", () => {
    const model = {
      id: "legacy",
      providerID: "provider",
      name: "Legacy model",
      enabled: true,
      cost: [{ input: 0, output: 0 }],
      limit: { context: 1000 },
    } as ModelInfo;
    const result = presentOpenCodeModel(model);
    expect(result.supportsTools).toBe(false);
    expect(result.supportsImageInput).toBe(false);
  });

  it("maps native sessions into the existing conversation header shape", () => {
    const session = {
      id: "ses_1",
      title: "Remote task",
      time: { created: 1, updated: 2 },
      model: { id: "m", providerID: "p" },
    } as SessionInfo;
    expect(presentOpenCodeConversation(session)).toMatchObject({
      id: "ses_1",
      title: "Remote task",
      providerId: "harness:opencode",
      modelId: "m",
      selectedFileIds: [],
    });
  });

  it("renders tool traces and reasoning through normal chat metadata", () => {
    const messages = [
      {
        id: "msg_1",
        type: "assistant",
        agent: "build",
        time: { created: 1 },
        content: [
          { type: "reasoning", text: "Consider this" },
          { type: "text", text: "Result" },
          {
            type: "tool",
            id: "tool_1",
            name: "shell",
            time: { created: 1 },
            state: {
              status: "completed",
              input: { command: "pwd" },
              content: [{ type: "text", text: "/project" }],
            },
          },
        ],
      },
    ] as SessionMessageInfo[];
    const [message] = presentOpenCodeMessages(messages, "ses_1", true);
    expect(message.content).toBe("Result");
    expect(message.status).toBe("streaming");
    expect(message.metadata?.reasoning?.[0].text).toBe("Consider this");
    expect(message.metadata?.toolExecutions?.[0]).toMatchObject({
      toolName: "shell",
      status: "completed",
      outputSummary: "/project",
      preview: { title: "pwd", text: "/project", truncated: false },
    });
    expect(presentOpenCodeMessages(messages, "ses_1", false)[0].status).toBe(
      "completed",
    );
  });

  it("uses the useful tool input as the trace preview title", () => {
    const messages = [
      {
        id: "msg_tools",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: 1 },
        content: [
          {
            type: "tool",
            id: "tool_read",
            name: "read",
            time: { created: 1 },
            state: {
              status: "completed",
              input: { filePath: "/repo/src/app.ts" },
              content: [{ type: "text", text: "export {};" }],
            },
          },
          {
            type: "tool",
            id: "tool_grep",
            name: "grep",
            time: { created: 1 },
            state: {
              status: "completed",
              input: { pattern: "needle", path: "/repo" },
              content: [{ type: "text", text: "src/app.ts:1:needle" }],
            },
          },
        ],
      },
    ] as SessionMessageInfo[];

    const [message] = presentOpenCodeMessages(messages, "ses_1", false);
    expect(
      message.metadata?.toolExecutions?.map((record) => record.preview?.title),
    ).toEqual(["/repo/src/app.ts", "needle"]);
  });

  it("caps oversized tool output in the trace preview", () => {
    const output = "x".repeat(20_005);
    const messages = [
      {
        id: "msg_long",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: 1 },
        content: [
          {
            type: "tool",
            id: "tool_long",
            name: "shell",
            time: { created: 1 },
            state: {
              status: "completed",
              input: { command: "cat big.log" },
              content: [{ type: "text", text: output }],
            },
          },
        ],
      },
    ] as SessionMessageInfo[];

    const [message] = presentOpenCodeMessages(messages, "ses_1", false);
    const preview = message.metadata?.toolExecutions?.[0].preview;
    expect(preview?.text).toHaveLength(20_000);
    expect(preview?.truncated).toBe(true);
  });

  it("previews safe remote images but never host file paths", () => {
    const messages = [
      {
        id: "msg_images",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: 1 },
        content: [
          {
            type: "tool",
            id: "tool_remote_image",
            name: "read",
            time: { created: 1 },
            state: {
              status: "completed",
              input: { filePath: "/repo/photo.png" },
              content: [
                {
                  type: "file",
                  uri: "https://example.com/photo.png",
                  mime: "image/png",
                  name: "photo.png",
                },
              ],
            },
          },
          {
            type: "tool",
            id: "tool_host_image",
            name: "read",
            time: { created: 1 },
            state: {
              status: "completed",
              input: { filePath: "/repo/secret.png" },
              content: [
                {
                  type: "file",
                  uri: "file:///repo/secret.png",
                  mime: "image/png",
                  name: "secret.png",
                },
              ],
            },
          },
        ],
      },
    ] as SessionMessageInfo[];

    const [message] = presentOpenCodeMessages(messages, "ses_1", false);
    expect(message.metadata?.toolExecutions?.[0].preview).toMatchObject({
      title: "/repo/photo.png",
      uri: "https://example.com/photo.png",
      mimeType: "image/png",
    });
    expect(message.metadata?.toolExecutions?.[1].preview).toEqual({
      title: "/repo/secret.png",
      text: "[file] secret.png",
      truncated: false,
    });
  });

  it("keeps the latest completed step streaming while the session is still running", () => {
    const messages = [
      {
        id: "msg_user",
        type: "user",
        text: "Do the task",
        time: { created: 1 },
      },
      {
        id: "msg_step_1",
        type: "assistant",
        agent: "build",
        time: { created: 2, completed: 3 },
        content: [{ type: "text", text: "First step." }],
      },
      {
        id: "msg_step_2",
        type: "assistant",
        agent: "build",
        time: { created: 4, completed: 5 },
        content: [{ type: "text", text: "Second step." }],
      },
    ] as SessionMessageInfo[];

    const whileRunning = presentOpenCodeMessages(messages, "ses_1", true);
    expect(whileRunning.map((message) => message.status)).toEqual([
      "completed",
      "completed",
      "streaming",
    ]);

    const afterStop = presentOpenCodeMessages(messages, "ses_1", false);
    expect(afterStop.map((message) => message.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("keeps session IDs and message IDs stable across snapshot reconciliation", () => {
    const messages = [
      { id: "msg_user", type: "user", text: "Hello", time: { created: 1 } },
    ] as SessionMessageInfo[];
    expect(presentOpenCodeMessages(messages, "ses_a", false)[0]).toMatchObject({
      id: "msg_user",
      conversationId: "ses_a",
      role: "user",
      content: "Hello",
    });
  });

  it("keeps system rows out of the chat UI but available for transcript sync", () => {
    const messages = [
      {
        id: "msg_system",
        type: "system",
        text: "Instructions",
        time: { created: 1 },
        metadata: { mobileAgentMessageId: "local-system" },
      },
      {
        id: "msg_user",
        type: "user",
        text: "Hello",
        time: { created: 2 },
        metadata: { mobileAgentMessageId: "local-user" },
      },
    ] as SessionMessageInfo[];

    expect(
      presentOpenCodeMessages(messages, "ses_1", false).map(
        (message) => message.role,
      ),
    ).toEqual(["user"]);
    expect(
      presentOpenCodeMessages(messages, "ses_1", false, "chat_1", true).map(
        (message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        }),
      ),
    ).toEqual([
      { id: "local-system", role: "system", content: "Instructions" },
      { id: "local-user", role: "user", content: "Hello" },
    ]);
  });

  it("maps imported messages back to the local conversation and message IDs", () => {
    const messages = [
      {
        id: "msg_imported_user",
        type: "user",
        text: "Hello",
        time: { created: 1 },
        metadata: { mobileAgentMessageId: "local-user" },
      },
      {
        id: "msg_imported_assistant",
        type: "assistant",
        agent: "build",
        time: { created: 2, completed: 3 },
        content: [{ type: "text", text: "Hi" }],
        metadata: { mobileAgentMessageId: "local-assistant" },
      },
    ] as SessionMessageInfo[];

    expect(
      presentOpenCodeMessages(messages, "ses_remote", false, "chat_local").map(
        (message) => ({
          id: message.id,
          conversationId: message.conversationId,
        }),
      ),
    ).toEqual([
      { id: "local-user", conversationId: "chat_local" },
      { id: "local-assistant", conversationId: "chat_local" },
    ]);
  });
});

describe("OpenCode shared questionnaire adapter", () => {
  const form: FormInfo = {
    id: "form_1",
    sessionID: "ses_1",
    title: "Details",
    fields: [
      {
        key: "choice",
        type: "string",
        required: true,
        options: [{ label: "First", value: "first" }],
      },
      { key: "confirm", type: "boolean" },
      { key: "count", type: "integer" },
      {
        key: "many",
        type: "multiselect",
        options: [{ label: "First", value: "first" }],
      },
    ],
  };

  it("uses existing question choice labels and restores native values on reply", () => {
    expect(presentOpenCodeQuestionnaire(form, "Chat").items[0].choices).toEqual(
      ["First"],
    );
    expect(
      openCodeFormAnswer(form, [
        { id: "choice", value: "First" },
        { id: "confirm", value: "Yes" },
        { id: "count", value: "3" },
        { id: "many", value: ["First"] },
      ]),
    ).toEqual({ choice: "first", confirm: true, count: 3, many: ["first"] });
  });

  it("rejects invalid numeric and missing required answers before submission", () => {
    expect(() => openCodeFormAnswer(form, [])).toThrow("required");
    expect(() =>
      openCodeFormAnswer(form, [
        { id: "choice", value: "First" },
        { id: "count", value: "bad" },
      ]),
    ).toThrow("number");
  });
});
