import type { AgentMode, StoredMessage } from "@/core/types/app-state";

export type HarnessModelRef = {
  id: string;
  providerID: string;
};

/**
 * A harness-agnostic transcript that can be moved between the app's chat store
 * and a remote harness session. Tool execution details stay in the local
 * message metadata; only the conversational text is required for a handoff.
 */
export type HarnessConversationTransfer = {
  conversationId: string;
  title: string;
  messages: StoredMessage[];
  agent: string | null;
  agentMode?: AgentMode;
  model: HarnessModelRef | null;
  directory?: string | null;
};

export type HarnessConversationSnapshot = {
  title: string;
  /** IDs of every transferable message, including rows the UI omits. */
  messageIDs: string[];
  messages: StoredMessage[];
  agent: string | null;
  model: HarnessModelRef | null;
  running: boolean;
};

/**
 * Implemented by each harness adapter that can preserve a chat when the user
 * switches models. OpenCode is the first implementation; future harnesses can
 * provide the same contract without changing the local conversation store.
 */
export interface HarnessConversationAdapter {
  readonly providerId: string;
  exportConversation(
    input: { conversationId: string; sessionID: string },
    signal?: AbortSignal,
  ): Promise<HarnessConversationSnapshot>;
  importConversation(
    input: HarnessConversationTransfer,
    signal?: AbortSignal,
  ): Promise<{ sessionID: string }>;
  archiveSession?(sessionID: string, signal?: AbortSignal): Promise<void>;
}
