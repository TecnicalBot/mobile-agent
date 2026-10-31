import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";

const state = vi.hoisted(() => ({
  direct: {
    conversationAgentName: "build",
    agents: [{ id: "local-only", name: "Local agent" }],
    setConversationAgent: vi.fn(),
    selectConversation: vi.fn(),
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
}));

vi.mock("@/providers/app-state", () => ({ useChat: () => state.direct }));
vi.mock("@/providers/harness-state", () => ({
  useHarness: () => state.harness,
}));
vi.mock("@/providers/phone-bridge-state", () => ({
  usePhoneBridge: () => ({
    folder: null,
    sharing: null,
    pickFolder: vi.fn(),
    start: vi.fn(),
    clearFolder: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.harness.active = true;
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
