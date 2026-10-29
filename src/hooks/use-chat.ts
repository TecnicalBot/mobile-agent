import { useChat as useDirectChat } from "@/providers/app-state";
import { useHarness } from "@/providers/harness-state";
import type { AgentRun } from "@/core/types/app-state";

export function useChat() {
  const direct = useDirectChat();
  const harness = useHarness();
  const selectConversation = async (id: string) => {
    harness.deactivate();
    await direct.selectConversation(id);
  };
  if (!harness.active) return { ...direct, selectConversation };
  const runStatus: AgentRun["status"] | null = harness.pendingToolApproval
    ? "waiting_for_approval"
    : harness.pendingQuestionnaire
      ? "waiting_for_question"
      : harness.snapshot?.running || harness.mutating
        ? "running"
        : null;
  const unsupported = async () => {
    throw new Error("This action is not supported for OpenCode sessions.");
  };
  return {
    ...direct,
    selectConversation,
    currentConversation: harness.currentConversation,
    currentConversationRunStatus: runStatus,
    messages: harness.messages,
    sending: Boolean(runStatus),
    sendMessage: harness.sendMessage,
    stopSending: harness.stop,
    createConversation: async () => {
      await harness.newChat();
    },
    currentExternalFolderSession: null,
    currentSelectedFileIds: [],
    currentSelectedSkillIds: [],
    currentSelectedMcpServerIds: [],
    pendingInputs: [],
    pendingSecretRequest: null,
    pendingQuestionnaire: harness.pendingQuestionnaire,
    submitPendingQuestionnaire: harness.submitQuestionnaire,
    dismissPendingQuestionnaire: harness.dismissQuestionnaire,
    pendingToolApproval: harness.pendingToolApproval,
    approvePendingToolApproval: () => {
      void harness.replyPermission("once").catch(() => {});
    },
    // OpenCode's "always" is a saved permission, not a chat-only grant. Do not broaden it.
    approvePendingToolApprovalForChat: () => {
      void harness.replyPermission("once").catch(() => {});
    },
    denyPendingToolApproval: () => {
      void harness.replyPermission("reject").catch(() => {});
    },
    editAndResendMessage: unsupported,
    pickConversationFolder: unsupported,
    currentSelectedAgentId: harness.currentAgentID,
    conversationAgentName: harness.currentAgentName,
    agents: harness.agents,
    setConversationAgent: async (
      conversationId: string,
      agentIdOrName: string | null,
    ) => {
      if (conversationId && conversationId !== harness.sessionID)
        throw new Error("Select the OpenCode chat before changing its agent.");
      await harness.selectAgent(agentIdOrName);
    },
    skills: [],
    workspaceFiles: [],
  };
}
