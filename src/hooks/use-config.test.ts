import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "./use-config";

const state = vi.hoisted(() => ({
  direct: {
    activeModels: [],
    currentModel: null,
    selectModel: vi.fn(),
  },
  directChat: {
    currentConversation: { id: "local-chat" } as { id: string } | null,
    selectConversation: vi.fn(),
  },
  harness: {
    active: false,
    availableModels: [],
    currentModel: null,
    selectModel: vi.fn(),
    attachConversation: vi.fn(),
    detachConversation: vi.fn(),
    deactivate: vi.fn(),
  },
}));

vi.mock("@/providers/app-state", () => ({
  useConfig: () => state.direct,
  useChat: () => state.directChat,
}));
vi.mock("@/providers/harness-state", () => ({
  useHarness: () => state.harness,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.harness.active = false;
  state.directChat.currentConversation = { id: "local-chat" };
  state.harness.detachConversation.mockResolvedValue(null);
});

describe("unified model selection", () => {
  it("links the current local chat before switching to a harness model", async () => {
    const ref = "harness:opencode/provider/model";
    await useConfig().selectModel(ref);

    expect(state.harness.attachConversation).toHaveBeenCalledWith(
      "local-chat",
      ref,
    );
    expect(state.harness.selectModel).not.toHaveBeenCalled();
    expect(state.direct.selectModel).not.toHaveBeenCalled();
  });

  it("switches models inside the active harness session", async () => {
    state.harness.active = true;
    const ref = "harness:opencode/provider/model";
    await useConfig().selectModel(ref);

    expect(state.harness.selectModel).toHaveBeenCalledWith(ref);
    expect(state.harness.attachConversation).not.toHaveBeenCalled();
  });

  it("starts a harness chat when there is no local conversation yet", async () => {
    state.directChat.currentConversation = null;
    const ref = "harness:opencode/provider/model";
    await useConfig().selectModel(ref);

    expect(state.harness.selectModel).toHaveBeenCalledWith(ref);
    expect(state.harness.attachConversation).not.toHaveBeenCalled();
  });

  it("copies the harness transcript back before switching to a direct model", async () => {
    state.harness.active = true;
    state.harness.detachConversation.mockResolvedValue("linked-chat");
    const ref = "provider/model";
    await useConfig().selectModel(ref);

    expect(state.harness.detachConversation).toHaveBeenCalledTimes(1);
    expect(state.harness.deactivate).toHaveBeenCalledTimes(1);
    expect(state.directChat.selectConversation).toHaveBeenCalledWith(
      "linked-chat",
    );
    expect(state.direct.selectModel).toHaveBeenCalledWith(ref);
    expect(
      state.harness.detachConversation.mock.invocationCallOrder[0],
    ).toBeLessThan(state.direct.selectModel.mock.invocationCallOrder[0]);
  });

  it("still switches direct models when copying the transcript fails", async () => {
    state.harness.active = true;
    state.harness.detachConversation.mockRejectedValue(new Error("offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = "provider/model";

    await useConfig().selectModel(ref);

    expect(state.harness.deactivate).toHaveBeenCalledTimes(1);
    expect(state.directChat.selectConversation).not.toHaveBeenCalled();
    expect(state.direct.selectModel).toHaveBeenCalledWith(ref);
    error.mockRestore();
  });

  it("switches direct models normally when the harness is inactive", async () => {
    const ref = "provider/model";
    await useConfig().selectModel(ref);

    expect(state.harness.detachConversation).not.toHaveBeenCalled();
    expect(state.direct.selectModel).toHaveBeenCalledWith(ref);
  });
});
