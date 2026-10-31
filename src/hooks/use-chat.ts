import { useChat as useDirectChat } from "@/providers/app-state";
import { useHarness } from "@/providers/harness-state";
import { usePhoneBridge } from "@/providers/phone-bridge-state";
import type { AgentRun } from "@/core/types/app-state";

export function useChat() {
  const direct = useDirectChat();
  const harness = useHarness();
  const phoneBridge = usePhoneBridge();
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
    currentExternalFolderSession:
      phoneBridge.sharing?.grant.folder ?? phoneBridge.folder,
    currentSelectedFileIds: harness.selectedFileIds,
    setCurrentSelectedFileIds: harness.setSelectedFileIds,
    // Skills and MCP servers are configured inside OpenCode, not in this app.
    currentSelectedSkillIds: [],
    setCurrentSelectedSkillIds: async () => {},
    currentSelectedMcpServerIds: [],
    setCurrentSelectedMcpServerIds: async () => {},
    pendingInputs: [],
    pendingSecretRequest: null,
    pendingQuestionnaire: harness.pendingQuestionnaire,
    submitPendingQuestionnaire: harness.submitQuestionnaire,
    dismissPendingQuestionnaire: harness.dismissQuestionnaire,
    pendingToolApproval: harness.pendingToolApproval,
    approvePendingToolApproval: () => {
      void harness.replyPermission("once").catch(() => {});
    },
    // Keep OpenCode's saved permission unchanged. Remember this one tool for
    // this chat; the harness replies once the saved approval is visible.
    approvePendingToolApprovalForChat: () => {
      const toolName = harness.pendingToolApproval?.toolName;
      if (harness.sessionID && toolName)
        direct.approveToolForChat(harness.sessionID, toolName);
    },
    denyPendingToolApproval: () => {
      void harness.replyPermission("reject").catch(() => {});
    },
    editAndResendMessage: unsupported,
    pickConversationFolder: async () => {
      const grant = phoneBridge.sharing?.grant ?? {
        folder: phoneBridge.folder,
        workspace: false,
        skills: false,
      };
      try {
        const selected = await phoneBridge.pickFolder();
        await phoneBridge.start({ ...grant, folder: selected });
        return selected;
      } catch (error) {
        // pickFolder revokes sharing before opening the picker. Restore the
        // previous grant when the user cancels or the new folder is invalid.
        await phoneBridge.start(grant).catch(() => {});
        throw error;
      }
    },
    clearConversationFolder: async () => {
      const grant = phoneBridge.sharing?.grant;
      if (grant && (grant.workspace || grant.skills)) {
        await phoneBridge.start({ ...grant, folder: null });
        return;
      }
      await phoneBridge.clearFolder();
    },
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
    workspaceFiles: direct.workspaceFiles,
  };
}
