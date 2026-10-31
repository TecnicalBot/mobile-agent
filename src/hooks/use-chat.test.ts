import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";

const state = vi.hoisted(() => ({
  direct: {
    conversationAgentName: "build",
    agents: [{ id: "local-only", name: "Local agent" }],
    setConversationAgent: vi.fn(),
    selectConversation: vi.fn(),
    setConversationApprovalMode: vi.fn(),
  },
  harness: {
    active: true,
    sessionID: "remote-session",
    currentAgentID: "plan",
    currentAgentName: "plan",
    agents: [{ id: "plan", name: "plan" }],
    selectAgent: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn(),
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

vi.mock("@/providers/app-state", () => ({ useChat: () => state.direct }));
vi.mock("@/providers/harness-state", () => ({
  useHarness: () => state.harness,
}));
vi.mock("@/providers/phone-bridge-state", () => ({
  usePhoneBridge: () => state.bridge,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.harness.active = true;
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
