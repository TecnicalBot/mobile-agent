import {
  useAppState as useDirectAppState,
  useChat as useDirectChat,
  useConfig as useDirectConfig,
} from "@/providers/app-state";
import { useHarness } from "@/providers/harness-state";
import { usePhoneBridge } from "@/providers/phone-bridge-state";
import type { AgentRun, ToolApprovalMode } from "@/core/types/app-state";

export function useChat() {
  const direct = useDirectChat();
  const directApp = useDirectAppState();
  const directConfig = useDirectConfig();
  const harness = useHarness();
  const phoneBridge = usePhoneBridge();
  const approvalControls = {
    deviceSharingApprovalMode: phoneBridge.sharing
      ? phoneBridge.approvalMode
      : null,
    setConversationApprovalMode: (
      conversationId: string,
      mode: ToolApprovalMode,
    ) => {
      direct.setConversationApprovalMode(conversationId, mode);
      // Harness approvals belong to the local chat as well as the remote
      // session, so switching providers or reattaching keeps the same choice.
      const linkedConversationId = harness.linkedConversationId;
      if (linkedConversationId && linkedConversationId !== conversationId) {
        if (conversationId === harness.sessionID) {
          direct.setConversationApprovalMode(linkedConversationId, mode);
        }
      } else if (
        linkedConversationId &&
        conversationId === linkedConversationId &&
        harness.sessionID &&
        harness.sessionID !== conversationId
      ) {
        direct.setConversationApprovalMode(harness.sessionID, mode);
      }
      phoneBridge.setApprovalMode(mode);
    },
  };
  const selectConversation = async (id: string) => {
    if (harness.active) {
      try {
        await harness.detachConversation();
      } catch (error) {
        console.error("Could not copy the harness transcript locally", error);
      }
    }
    harness.deactivate();
    await direct.selectConversation(id);
  };
  const renameConversation = async (id: string, title: string) => {
    await direct.renameConversation(id, title);
    void harness.renameLinkedConversation(id, title).catch((error) => {
      console.error("Could not rename the linked harness session", error);
    });
  };
  const deleteConversation = async (id: string) => {
    if (harness.active && harness.linkedConversationId === id) {
      harness.deactivate();
    }
    await harness.forgetConversation(id).catch((error) => {
      console.error("Could not archive the linked harness session", error);
    });
    await direct.deleteConversation(id);
  };
  const ready = directApp.ready && !(harness.active && harness.loading);
  if (!harness.active)
    return {
      ...direct,
      ...approvalControls,
      selectConversation,
      renameConversation,
      deleteConversation,
      ready,
      approvalConversationId: direct.currentConversation?.id ?? null,
      currentToolApprovalMode: direct.currentConversation
        ? (directConfig.conversationApprovalModes?.[
            direct.currentConversation.id
          ] ?? "ask")
        : "ask",
    };
  const runStatus: AgentRun["status"] | null = harness.pendingToolApproval
    ? "waiting_for_approval"
    : harness.pendingQuestionnaire
      ? "waiting_for_question"
      : harness.snapshot?.running ||
          harness.mutating ||
          harness.awaitingPrompt
        ? "running"
        : null;
  const unsupported = async () => {
    throw new Error("This action is not supported for harness sessions.");
  };
  return {
    ...direct,
    ...approvalControls,
    selectConversation,
    renameConversation,
    deleteConversation,
    ready,
    approvalConversationId:
      harness.linkedConversationId ?? harness.currentConversation?.id ?? null,
    currentToolApprovalMode: harness.approvalMode,
    currentConversation: harness.currentConversation,
    currentConversationRunStatus: runStatus,
    messages: harness.messages,
    sending: Boolean(runStatus),
    sendMessage: harness.sendMessage,
    stopSending: harness.stop,
    createConversation: async (input?: { agentId?: string | null }) => {
      if (harness.sessionID) {
        try {
          await harness.detachConversation();
        } catch (error) {
          console.error("Could not copy the harness transcript locally", error);
        }
      }
      harness.deactivate();
      await direct.createConversation(input);
    },
    currentExternalFolderSession:
      phoneBridge.sharing?.grant.folder ?? phoneBridge.folder,
    currentSelectedFileIds: harness.selectedFileIds,
    setCurrentSelectedFileIds: harness.setSelectedFileIds,
    // Skills are configured on the harness host. MCP servers are passed into
    // ACP harness sessions; OpenCode keeps its own host-side configuration.
    currentSelectedSkillIds: [],
    setCurrentSelectedSkillIds: async () => {},
    currentSelectedMcpServerIds: harness.selectedMcpServerIds,
    setCurrentSelectedMcpServerIds: async (ids: string[] | null) => {
      await harness.setSelectedMcpServerIds(ids);
    },
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
      if (!toolName) return;
      const approvalIDs = new Set(
        [
          harness.linkedConversationId,
          harness.sessionID,
          // A permission can belong to a chat the user switched away from.
          harness.pendingToolApproval?.conversationId,
          harness.pendingToolApproval?.runId,
        ].filter((id): id is string => Boolean(id)),
      );
      for (const id of approvalIDs) {
        direct.approveToolForChat(id, toolName);
      }
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
        throw new Error("Select the harness chat before changing its agent.");
      await harness.selectAgent(agentIdOrName);
    },
    skills: [],
    workspaceFiles: direct.workspaceFiles,
  };
}
