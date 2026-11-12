import { describe, expect, it } from "vitest";

import type { AppStateSnapshot, Conversation, WorkspaceFile } from "@/core/types/app-state";
import { EMPTY_SNAPSHOT } from "../constants";
import { reconcileHydratedAttachments } from "../reconcile-attachments";

const photo: WorkspaceFile = {
  id: "photo",
  displayName: "photo.jpg",
  originalName: "photo.jpg",
  mimeType: "image/jpeg",
  relativePath: "photo.jpg",
  size: 10,
  sourceKind: "imported",
  sourceMarkdown: null,
  sourceSpec: null,
  createdAt: "2026-10-17",
  updatedAt: "2026-10-17",
};

function snapshot(selectedFileIds: string[], id = "chat"): AppStateSnapshot {
  const conversation: Conversation = {
    id,
    title: "Chat",
    providerId: null,
    modelId: null,
    reasoningEffort: "medium",
    agentId: null,
    agentMode: "build",
    selectedFileIds,
    selectedMcpServerIds: null,
    selectedSkillIds: [],
    externalFolderSession: null,
    parentConversationId: null,
    rootConversationId: null,
    relationshipToParent: null,
    pinnedAt: null,
    createdAt: "2026-10-17",
    updatedAt: "2026-10-17",
    archivedAt: null,
  };
  return {
    ...EMPTY_SNAPSHOT,
    currentConversation: conversation,
    conversations: [conversation],
    currentSelectedFileIds: selectedFileIds,
    workspaceFiles: selectedFileIds.length ? [photo] : [],
  };
}

describe("foreground attachment reconciliation", () => {
  it("keeps a photo selected after an older foreground refresh finishes", () => {
    const result = reconcileHydratedAttachments(snapshot([]), snapshot(["photo"]), true);
    expect(result.currentSelectedFileIds).toEqual(["photo"]);
    expect(result.currentConversation?.selectedFileIds).toEqual(["photo"]);
    expect(result.conversations[0].selectedFileIds).toEqual(["photo"]);
    expect(result.workspaceFiles).toEqual([photo]);
  });

  it("does not restore an attachment removed during the refresh", () => {
    const result = reconcileHydratedAttachments(snapshot(["photo"]), snapshot([]), true);
    expect(result.currentSelectedFileIds).toEqual([]);
    expect(result.currentConversation?.selectedFileIds).toEqual([]);
  });

  it("uses the database selection when no local selection changed", () => {
    const hydrated = snapshot(["photo"]);
    expect(reconcileHydratedAttachments(hydrated, snapshot([]), false)).toBe(hydrated);
  });

  it("never transfers attachments into a different conversation", () => {
    const hydrated = snapshot([], "other-chat");
    expect(reconcileHydratedAttachments(hydrated, snapshot(["photo"]), true)).toBe(hydrated);
  });
});
