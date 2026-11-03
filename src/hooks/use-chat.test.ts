import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";

const state = vi.hoisted(() => ({
  direct: {
    conversationAgentName: "build",
    ready: true,
    agents: [{ id: "local-only", name: "Local agent" }],
    setConversationAgent: vi.fn(),
    selectConversation: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
    setConversationApprovalMode: vi.fn(),
  },
  harness: {
    active: true,
    sessionID: "remote-session",
    linkedConversationId: "local-chat" as string | null,
    loading: false,
    approvalMode: "ask" as "ask" | "auto",
    currentAgentID: "plan",
    currentAgentName: "plan",
    agents: [{ id: "plan", name: "plan" }],
    selectAgent: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn(),
    detachConversation: vi.fn(),
    forgetConversation: vi.fn(),
    renameLinkedConversation: vi.fn(),
    newChat: vi.fn(),
  },
  bridge: {
    folder: null,
    sharing: null as {
      id: string;
      grant: { folder: { uri: string } | null };
    } | null,
    approvalMode: "ask" as "ask" | "auto",
    setApprovalMode: vi.fn(),
    pickFolder: vi.fn(),
    start: vi.fn(),
    clearFolder: vi.fn(),
  },
}));

vi.mock("@/providers/app-state", () => ({
  useAppState: () => ({
    ready: state.direct.ready,
  }),
  useChat: () => state.direct,
  useConfig: () => ({ conversationApprovalModes: {} }),
}));
vi.mock("@/providers/harness-state", () => ({
  useHarness: () => state.harness,
}));
vi.mock("@/providers/phone-bridge-state", () => ({
  usePhoneBridge: () => state.bridge,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.harness.active = true;
  state.harness.linkedConversationId = "local-chat";
  state.harness.detachConversation.mockResolvedValue(null);
  state.harness.forgetConversation.mockResolvedValue(undefined);
  state.harness.renameLinkedConversation.mockResolvedValue(undefined);
  state.direct.createConversation.mockResolvedValue(undefined);
  state.direct.deleteConversation.mockResolvedValue(undefined);
  state.direct.renameConversation.mockResolvedValue(undefined);
  state.bridge.sharing = null;
  state.bridge.approvalMode = "ask";
});

describe("unified chat and device approval controls", () => {
  it.each([true, false])(
    "updates both approval gates (harness: %s)",
    (active) => {
      state.harness.active = active;
      useChat().setConversationApprovalMode("chat", "auto");
      expect(state.direct.setConversationApprovalMode).toHaveBeenCalledWith(
        "chat",
        "auto",
      );
      expect(state.bridge.setApprovalMode).toHaveBeenCalledWith("auto");
    },
  );

  it("switches both gates back to asking", () => {
    useChat().setConversationApprovalMode("chat", "ask");
    expect(state.direct.setConversationApprovalMode).toHaveBeenCalledWith(
      "chat",
      "ask",
    );
    expect(state.bridge.setApprovalMode).toHaveBeenCalledWith("ask");
  });

  it("shows the live device policy rather than assuming a saved chat mode authorizes it", () => {
    state.bridge.sharing = {
      id: "sharing-session",
      grant: { folder: null },
    };
    expect(useChat().deviceSharingApprovalMode).toBe("ask");
    state.bridge.approvalMode = "auto";
    expect(useChat().deviceSharingApprovalMode).toBe("auto");
    state.bridge.sharing = null;
    expect(useChat().deviceSharingApprovalMode).toBeNull();
    expect(state.bridge.setApprovalMode).not.toHaveBeenCalled();
  });

  it("shows the harness's effective approval mode", () => {
    state.harness.approvalMode = "auto";
    expect(useChat().currentToolApprovalMode).toBe("auto");
    state.harness.approvalMode = "ask";
    expect(useChat().currentToolApprovalMode).toBe("ask");
  });
});

describe("shared chat loading", () => {
  it("keeps the chat loader visible while a harness session snapshot loads", () => {
    state.harness.loading = true;
    expect(useChat().ready).toBe(false);
    state.harness.loading = false;
    expect(useChat().ready).toBe(true);
  });

  it("does not let harness loading hide direct chats", () => {
    state.harness.active = false;
    state.harness.loading = true;
    expect(useChat().ready).toBe(true);
  });
});

describe("shared chat agent selection", () => {
  it("shows the real harness agent, not the harness name or local agent catalog", () => {
    const chat = useChat();
    expect(chat.conversationAgentName).toBe("plan");
    expect(chat.currentSelectedAgentId).toBe("plan");
    expect(chat.agents).toEqual(state.harness.agents);
  });

  it("switches the remote session agent without modifying the direct chat", async () => {
    await useChat().setConversationAgent("remote-session", "build");
    expect(state.harness.selectAgent).toHaveBeenCalledWith("build");
    expect(state.direct.setConversationAgent).not.toHaveBeenCalled();
  });

  it("supports choosing an agent before the first harness message", async () => {
    await useChat().setConversationAgent("", "plan");
    expect(state.harness.selectAgent).toHaveBeenCalledWith("plan");
  });

  it("rejects switches targeting a different session", async () => {
    await expect(
      useChat().setConversationAgent("other-session", "plan"),
    ).rejects.toThrow("Select the OpenCode chat");
    expect(state.harness.selectAgent).not.toHaveBeenCalled();
  });

  it("leaves direct-provider agent selection unchanged", () => {
    state.harness.active = false;
    const chat = useChat();
    expect(chat.conversationAgentName).toBe("build");
    expect(chat.setConversationAgent).toBe(state.direct.setConversationAgent);
  });
});

describe("linked conversation switching", () => {
  it("copies the active harness transcript locally before selecting another chat", async () => {
    state.harness.detachConversation.mockResolvedValue("linked-local");
    const chat = useChat();
    await chat.selectConversation("next-chat");

    expect(state.harness.detachConversation).toHaveBeenCalledTimes(1);
    expect(state.harness.deactivate).toHaveBeenCalledTimes(1);
    expect(state.direct.selectConversation).toHaveBeenCalledWith("next-chat");
    expect(
      state.harness.detachConversation.mock.invocationCallOrder[0],
    ).toBeLessThan(state.harness.deactivate.mock.invocationCallOrder[0]);
  });

  it("deactivates the harness and creates a normal chat for a new conversation", async () => {
    const chat = useChat();
    await chat.createConversation({ agentId: "local-agent" });

    expect(state.harness.detachConversation).toHaveBeenCalledTimes(1);
    expect(state.harness.deactivate).toHaveBeenCalledTimes(1);
    expect(state.direct.createConversation).toHaveBeenCalledWith({
      agentId: "local-agent",
    });
  });

  it("archives a linked harness session before deleting its local chat", async () => {
    const chat = useChat();
    await chat.deleteConversation("local-chat");

    expect(state.harness.forgetConversation).toHaveBeenCalledWith("local-chat");
    expect(state.direct.deleteConversation).toHaveBeenCalledWith("local-chat");
    expect(
      state.harness.forgetConversation.mock.invocationCallOrder[0],
    ).toBeLessThan(state.direct.deleteConversation.mock.invocationCallOrder[0]);
  });

  it("renames both the local chat and its linked harness session", async () => {
    const chat = useChat();
    await chat.renameConversation("local-chat", "New title");

    expect(state.direct.renameConversation).toHaveBeenCalledWith(
      "local-chat",
      "New title",
    );
    expect(state.harness.renameLinkedConversation).toHaveBeenCalledWith(
      "local-chat",
      "New title",
    );
  });
});
