import { describe, expect, it } from "vitest";
import type { Conversation, StoredMessage } from "@/core/types/app-state";
import {
  keepSelectedConversation,
  type ConversationSelectionState,
} from "../conversation-selection";

function conversation(id: string): Conversation {
  return {
    id,
    title: id,
    providerId: null,
    modelId: null,
    reasoningEffort: "medium",
    agentId: null,
    agentMode: "build",
    selectedFileIds: [],
    selectedMcpServerIds: null,
    selectedSkillIds: [],
    externalFolderSession: null,
    parentConversationId: null,
    rootConversationId: null,
    relationshipToParent: null,
    pinnedAt: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function message(id: string, conversationId: string): StoredMessage {
  return {
    id,
    conversationId,
    role: "user",
    content: id,
    metadata: null,
    status: "completed",
    error: null,
    sequence: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function state(
  id: string,
  messages: StoredMessage[],
  extra: Partial<ConversationSelectionState> = {},
): ConversationSelectionState {
  return {
    conversations: [conversation(id)],
    currentConversation: conversation(id),
    currentSelectedAgentId: null,
    currentSelectedFileIds: [],
    currentSelectedMcpServerIds: null,
    currentSelectedSkillIds: [],
    messages,
    settings: { activeConversationId: id },
    ...extra,
  };
}

const mergeConversations = (
  conversations: Conversation[],
  conversationToMerge: Conversation,
) => [
  ...conversations.filter((item) => item.id !== conversationToMerge.id),
  conversationToMerge,
];

describe("hydrate conversation selection guard", () => {
  it("publishes the hydrated conversation when no selection happened", () => {
    const hydrated = state("saved", [message("hydrated", "saved")]);
    const current = state("saved", []);

    expect(
      keepSelectedConversation(hydrated, current, {
        mergeConversations,
        selectionChanged: false,
      }),
    ).toBe(hydrated);
  });

  it("publishes the hydrated conversation when it is the same chat", () => {
    const hydrated = state("saved", [message("hydrated", "saved")]);
    const current = state("saved", []);

    expect(
      keepSelectedConversation(hydrated, current, {
        mergeConversations,
        selectionChanged: true,
      }),
    ).toBe(hydrated);
  });

  it("keeps the chat opened while hydration was reading", () => {
    const hydrated = state("saved", [message("stale", "saved")]);
    const current = state("opened", [message("fresh", "opened")]);

    const result = keepSelectedConversation(hydrated, current, {
      mergeConversations,
      selectionChanged: true,
    });

    expect(result.currentConversation?.id).toBe("opened");
    expect(result.messages).toBe(current.messages);
    expect(result.settings.activeConversationId).toBe("opened");
  });

  it("keeps chats created while hydration was reading", () => {
    const hydrated = state("saved", []);
    const current = state("opened", [], {
      conversations: [conversation("opened"), conversation("new-chat")],
    });

    const result = keepSelectedConversation(hydrated, current, {
      mergeConversations,
      selectionChanged: true,
    });

    expect(result.conversations.map((item) => item.id).sort()).toEqual([
      "new-chat",
      "opened",
      "saved",
    ]);
  });
});
