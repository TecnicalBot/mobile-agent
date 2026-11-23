import type { Conversation, StoredMessage } from "@/core/types/app-state";

/** The slice of app state that belongs to the conversation currently on screen. */
export type ConversationSelectionState = {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  currentSelectedAgentId: string | null;
  currentSelectedFileIds: string[];
  currentSelectedMcpServerIds: string[] | null;
  currentSelectedSkillIds: string[];
  messages: StoredMessage[];
  settings: { activeConversationId: string | null };
};

/**
 * Hydration reads the database for several hundred milliseconds. If the user
 * opens a different chat while it is still reading, publishing the hydrated
 * conversation would navigate them back a few seconds later. Keep the chat they
 * opened, and merge in every row that hydration did load.
 */
export function keepSelectedConversation<T extends ConversationSelectionState>(
  hydrated: T,
  current: T,
  options: {
    mergeConversations: (
      conversations: Conversation[],
      conversation: Conversation,
    ) => Conversation[];
    selectionChanged: boolean;
  },
): T {
  if (!options.selectionChanged) return hydrated;
  if (current.currentConversation?.id === hydrated.currentConversation?.id)
    return hydrated;
  return {
    ...hydrated,
    // Keep chats created while hydration was reading.
    conversations: current.conversations.reduce(
      (conversations, conversation) =>
        options.mergeConversations(conversations, conversation),
      hydrated.conversations,
    ),
    currentConversation: current.currentConversation,
    currentSelectedAgentId: current.currentSelectedAgentId,
    currentSelectedFileIds: current.currentSelectedFileIds,
    currentSelectedMcpServerIds: current.currentSelectedMcpServerIds,
    currentSelectedSkillIds: current.currentSelectedSkillIds,
    messages: current.messages,
    settings: {
      ...hydrated.settings,
      activeConversationId: current.settings.activeConversationId,
    },
  };
}
