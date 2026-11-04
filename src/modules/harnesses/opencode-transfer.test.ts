import { describe, expect, it, vi } from "vitest";
import type {
  OpenCodeClient,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client";
import type { StoredMessage } from "@/core/types/app-state";
import {
  buildDetachedTranscriptText,
  createOpenCodeConversationAdapter,
  detachedLocalMessages,
  localMessagesToOpenCode,
  mergeHarnessTranscript,
} from "./opencode-transfer";

const session = {
  id: "ses_template",
  projectID: "project_1",
  title: "Template",
  time: { created: 1, updated: 2 },
  location: { directory: "/workspace" },
  metadata: { existing: "value" },
} as unknown as SessionInfo;

const messages: StoredMessage[] = [
  {
    id: "local-system",
    conversationId: "chat_local",
    role: "system",
    content: "System instructions",
    status: "completed",
    sequence: 1,
    metadata: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "local-user",
    conversationId: "chat_local",
    role: "user",
    content: "Hello",
    status: "completed",
    sequence: 2,
    metadata: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "local-assistant",
    conversationId: "chat_local",
    role: "assistant",
    content: "Hi there",
    status: "completed",
    sequence: 3,
    metadata: null,
    error: null,
    createdAt: "2026-01-01T00:00:01.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  },
  {
    id: "local-empty",
    conversationId: "chat_local",
    role: "assistant",
    content: "   ",
    status: "completed",
    sequence: 4,
    metadata: null,
    error: null,
    createdAt: "2026-01-01T00:00:02.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
  },
];

function makeClient(overrides: {
  list?: OpenCodeClient["session"]["list"];
  create?: OpenCodeClient["session"]["create"];
}) {
  const importMock = vi.fn().mockResolvedValue({});
  const removeMock = vi.fn().mockResolvedValue(undefined);
  const updateMock = vi.fn().mockResolvedValue(undefined);
  const exportMock = vi.fn().mockResolvedValue({
    info: session,
    messages: [
      {
        id: "msg_remote_system",
        type: "system",
        text: "System instructions",
        time: { created: 9 },
        metadata: { mobileAgentMessageId: "local-system" },
      },
      {
        id: "msg_remote_user",
        type: "user",
        text: "Hello",
        time: { created: 10 },
        metadata: { mobileAgentMessageId: "local-user" },
      },
      {
        id: "msg_remote_assistant",
        type: "assistant",
        agent: "build",
        time: { created: 11, completed: 12 },
        content: [{ type: "text", text: "Hi there" }],
        metadata: { mobileAgentMessageId: "local-assistant" },
      },
    ] as SessionMessageInfo[],
  });

  const client = {
    session: {
      export: exportMock,
      import: importMock,
      list:
        overrides.list ??
        vi.fn().mockResolvedValue({ data: [session], cursor: null }),
      create:
        overrides.create ??
        vi.fn().mockResolvedValue({ ...session, id: "ses_temporary" }),
      remove: removeMock,
      update: updateMock,
    },
  } as unknown as OpenCodeClient;

  return { client, importMock, removeMock, updateMock, exportMock };
}

describe("localMessagesToOpenCode", () => {
  it("preserves local IDs in metadata and keeps message times ordered", () => {
    const imported = localMessagesToOpenCode({
      conversationId: "chat_local",
      title: "Imported",
      messages,
      agent: "build",
      agentMode: "build",
      model: { id: "model_1", providerID: "provider_1" },
    });

    expect(imported).toHaveLength(3);
    expect(imported[0]).toMatchObject({
      type: "system",
      text: "System instructions",
      metadata: {
        mobileAgentConversationId: "chat_local",
        mobileAgentMessageId: "local-system",
      },
    });
    expect(imported[1]).toMatchObject({
      type: "user",
      text: "Hello",
      metadata: { mobileAgentMessageId: "local-user" },
    });
    expect(imported[2]).toMatchObject({
      type: "assistant",
      agent: "build",
      model: { id: "model_1", providerID: "provider_1" },
      content: [{ type: "text", text: "Hi there" }],
      metadata: { mobileAgentMessageId: "local-assistant" },
    });

    const times = imported.map((message) => message.time.created);
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(new Set(times).size).toBe(times.length);
    expect("completed" in imported[2].time).toBe(true);
    expect(imported[2]).toMatchObject({ finish: "stop" });
  });

  it("imports interrupted assistant rows as finished history", () => {
    const [assistant] = localMessagesToOpenCode({
      conversationId: "chat_local",
      title: "Imported",
      messages: [
        {
          ...messages[2],
          status: "streaming",
        },
      ],
      agent: "build",
      agentMode: "build",
      model: { id: "model_1", providerID: "provider_1" },
    });
    expect(assistant).toMatchObject({
      type: "assistant",
      finish: "stop",
      time: { created: expect.any(Number), completed: expect.any(Number) },
    });
  });

  it("falls back to default agent and unknown model when absent", () => {
    const [assistant] = localMessagesToOpenCode({
      conversationId: "chat_local",
      title: "Imported",
      messages: [messages[2]],
      agent: null,
      model: null,
    });
    expect(assistant).toMatchObject({
      type: "assistant",
      agent: "build",
      model: { id: "unknown", providerID: "unknown" },
    });
  });
});

function storedMessage(
  id: string,
  role: StoredMessage["role"],
  content: string,
  createdAt: string,
  sequence: number,
): StoredMessage {
  return {
    id,
    conversationId: "chat_local",
    role,
    content,
    status: "completed",
    sequence,
    metadata: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("detached transcript reconciliation", () => {
  const remote = [
    storedMessage(
      "local-user",
      "user",
      "Hello",
      "2026-01-01T00:00:00.000Z",
      1,
    ),
    storedMessage(
      "local-assistant",
      "assistant",
      "Hi there",
      "2026-01-01T00:00:01.000Z",
      2,
    ),
  ];
  const localOnly = storedMessage(
    "local-direct",
    "user",
    "Sent while detached",
    "2026-01-01T00:00:02.000Z",
    3,
  );

  it("finds rows that the remote session has never seen", () => {
    expect(
      detachedLocalMessages(remote, [...remote, localOnly]).map(
        (message) => message.id,
      ),
    ).toEqual(["local-direct"]);
  });

  it("merges local-only rows without dropping remote messages", () => {
    const merged = mergeHarnessTranscript(remote, [...remote, localOnly]);
    expect(merged.map((message) => message.id)).toEqual([
      "local-user",
      "local-assistant",
      "local-direct",
    ]);
  });

  it("interleaves a detached row by time", () => {
    const between = storedMessage(
      "local-between",
      "user",
      "Sent between turns",
      "2026-01-01T00:00:00.500Z",
      3,
    );
    const merged = mergeHarnessTranscript(remote, [...remote, between]);
    expect(merged.map((message) => message.id)).toEqual([
      "local-user",
      "local-between",
      "local-assistant",
    ]);
  });

  it("builds hidden catch-up context from conversational rows only", () => {
    const text = buildDetachedTranscriptText([
      storedMessage(
        "system",
        "system",
        "ignored",
        "2026-01-01T00:00:00.000Z",
        1,
      ),
      localOnly,
      storedMessage(
        "assistant",
        "assistant",
        "Answer while detached",
        "2026-01-01T00:00:03.000Z",
        2,
      ),
      storedMessage("empty", "assistant", "   ", "2026-01-01T00:00:04.000Z", 3),
    ]);

    expect(text).toContain("User: Sent while detached");
    expect(text).toContain("Assistant: Answer while detached");
    expect(text).not.toContain("ignored");
    expect(text).not.toContain("empty");
  });

  it("returns no catch-up text when there is nothing conversational", () => {
    expect(
      buildDetachedTranscriptText([
        storedMessage(
          "system",
          "system",
          "ignored",
          "2026-01-01T00:00:00.000Z",
          1,
        ),
      ]),
    ).toBeNull();
  });
});

describe("OpenCode conversation transfer adapter", () => {
  it("imports a transcript using an existing session as the info template", async () => {
    const { client, importMock, removeMock } = makeClient({});
    const adapter = createOpenCodeConversationAdapter(client);

    const result = await adapter.importConversation({
      conversationId: "chat_local",
      title: "Follow-up",
      messages,
      agent: "plan",
      agentMode: "plan",
      model: { id: "model_1", providerID: "provider_1" },
      directory: "/workspace",
    });

    expect(result.sessionID).toMatch(/^ses_mobile_/);
    expect(importMock).toHaveBeenCalledTimes(1);
    const payload = importMock.mock.calls[0][0];
    expect(payload.info).toMatchObject({
      id: result.sessionID,
      projectID: "project_1",
      title: "Follow-up",
      agent: "plan",
      model: { id: "model_1", providerID: "provider_1" },
      metadata: {
        existing: "value",
        mobileAgentConversationId: "chat_local",
      },
    });
    expect(payload.messages).toHaveLength(3);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("creates and removes a temporary template when no session exists", async () => {
    const { client, importMock, removeMock } = makeClient({
      list: vi.fn().mockResolvedValue({ data: [], cursor: null }),
      create: vi.fn().mockResolvedValue({ ...session, id: "ses_temporary" }),
    });
    const adapter = createOpenCodeConversationAdapter(client);

    await adapter.importConversation({
      conversationId: "chat_local",
      title: "New chat",
      messages,
      agent: null,
      model: null,
    });

    expect(importMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledWith(
      { sessionID: "ses_temporary" },
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("exports remote messages back to their local IDs", async () => {
    const { client, exportMock } = makeClient({});
    const adapter = createOpenCodeConversationAdapter(client);

    const exported = await adapter.exportConversation({
      conversationId: "chat_local",
      sessionID: "ses_remote",
    });

    expect(exportMock).toHaveBeenCalledWith(
      { sessionID: "ses_remote" },
      expect.objectContaining({ signal: undefined }),
    );
    expect(exported.messages.map((message) => message.id)).toEqual([
      "local-system",
      "local-user",
      "local-assistant",
    ]);
    expect(
      exported.messages.every((message) => message.status === "completed"),
    ).toBe(true);
    expect(exported).toMatchObject({
      title: "Template",
      messageIDs: ["local-system", "local-user", "local-assistant"],
      agent: null,
      model: null,
      running: false,
    });
  });

  it("archives linked sessions through the native update API", async () => {
    const { client, updateMock } = makeClient({});
    const adapter = createOpenCodeConversationAdapter(client);

    await adapter.archiveSession?.("ses_remote");
    expect(updateMock).toHaveBeenCalledWith(
      { sessionID: "ses_remote", archived: true },
      expect.objectContaining({ signal: undefined }),
    );
  });
});
