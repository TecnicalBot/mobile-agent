import { describe, expect, it } from "vitest";

import {
  parseConversationExport,
  serializeConversationExport,
} from "../chat-export";
import type { Conversation, StoredMessage } from "@/core/types/app-state";

const conversation: Conversation = {
  id: "conversation-1",
  title: "Build the mobile agent",
  providerId: "anthropic",
  modelId: "claude-sonnet-4",
  reasoningEffort: "high",
  agentId: "plan",
  agentMode: "plan",
  selectedFileIds: ["file-1"],
  selectedMcpServerIds: null,
  selectedSkillIds: [],
  externalFolderSession: null,
  pinnedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  archivedAt: null,
};

const messages: StoredMessage[] = [
  {
    id: "message-1",
    conversationId: "conversation-1",
    role: "user",
    content: "Hello",
    metadata: null,
    status: "completed",
    error: null,
    sequence: 1,
    createdAt: "2026-01-01T00:00:01.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  },
  {
    id: "message-2",
    conversationId: "conversation-1",
    role: "assistant",
    content: "Hi there",
    metadata: { usage: null },
    status: "completed",
    error: null,
    sequence: 2,
    createdAt: "2026-01-01T00:00:02.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
  },
];

describe("chat-export", () => {
  it("round-trips a conversation and its messages", () => {
    const serialized = serializeConversationExport(conversation, messages);
    const parsed = parseConversationExport(serialized);

    expect(parsed.format).toBe("mobile-agent-chat");
    expect(parsed.version).toBe(1);
    expect(parsed.conversation).toEqual(conversation);
    expect(parsed.messages).toEqual(messages);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseConversationExport("not json")).toThrow();
  });

  it("rejects non-object documents", () => {
    expect(() => parseConversationExport("42")).toThrow();
    expect(() => parseConversationExport("[]")).toThrow();
  });

  it("rejects the wrong format", () => {
    const invalid = JSON.stringify({ format: "something-else", version: 1 });
    expect(() => parseConversationExport(invalid)).toThrow(
      /not a Mobile Agent chat export/,
    );
  });

  it("rejects unsupported versions", () => {
    const invalid = JSON.stringify({ format: "mobile-agent-chat", version: 99 });
    expect(() => parseConversationExport(invalid)).toThrow(
      /Unsupported chat export version/,
    );
  });

  it("rejects documents missing a conversation or messages", () => {
    const noConversation = JSON.stringify({ format: "mobile-agent-chat", version: 1, messages: [] });
    expect(() => parseConversationExport(noConversation)).toThrow(/missing a conversation/);

    const noTitle = JSON.stringify({
      format: "mobile-agent-chat",
      version: 1,
      conversation: { id: "x" },
      messages: [],
    });
    expect(() => parseConversationExport(noTitle)).toThrow(/missing a conversation title/);

    const noMessages = JSON.stringify({ format: "mobile-agent-chat", version: 1, conversation });
    expect(() => parseConversationExport(noMessages)).toThrow(/missing its messages/);
  });

  it("rejects messages with an unknown role", () => {
    const invalid = JSON.stringify({
      format: "mobile-agent-chat",
      version: 1,
      conversation,
      messages: [{ role: "tool", content: "x", status: "completed" }],
    });
    expect(() => parseConversationExport(invalid)).toThrow(/invalid role/);
  });

  it("fills defaults for missing message sequence and timestamps", () => {
    const serialized = serializeConversationExport(conversation, messages);
    const parsed = JSON.parse(serialized) as { messages: StoredMessage[] };
    parsed.messages[0]!.sequence = undefined as unknown as number;
    parsed.messages[0]!.createdAt = "";
    parsed.messages[0]!.updatedAt = "";

    const reparsed = parseConversationExport(JSON.stringify(parsed));

    expect(reparsed.messages[0]!.sequence).toBe(1);
    expect(reparsed.messages[0]!.createdAt).toBe("");
    expect(reparsed.messages[0]!.updatedAt).toBe("");
  });
});