import { describe, expect, it, vi } from "vitest";

import { createConversationRepository } from "./conversation-repository";
import type { AppDatabase } from "./types";

vi.mock("expo-crypto", () => ({ randomUUID: vi.fn() }));
vi.mock("./shared", () => ({ nowIso: () => "2026-10-14T00:00:00.000Z" }));

describe("conversation lineage", () => {
  it("persists subagent lineage on create", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      insert: () => ({
        values: async (input: Record<string, unknown>) => {
          inserted.push(input);
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [inserted[0]],
          }),
        }),
      }),
    };
    const repository = createConversationRepository(
      db as unknown as AppDatabase,
    );

    const conversation = await repository.create({
      id: "child",
      parentConversationId: "parent",
      relationshipToParent: "subagent",
      rootConversationId: "root",
      title: "Research the repo",
    });

    expect(inserted[0]).toMatchObject({
      id: "child",
      parentConversationId: "parent",
      relationshipToParent: "subagent",
      rootConversationId: "root",
    });
    expect(conversation).toMatchObject({
      parentConversationId: "parent",
      relationshipToParent: "subagent",
      rootConversationId: "root",
    });
  });
});

describe("conversation metadata patches", () => {
  it("does not restore a stale file selection during a background title update", async () => {
    const row: Record<string, unknown> = { title: "Old", selectedFileIds: ["image-1"] };
    const db = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
            for (const [key, value] of Object.entries(patch)) {
              if (value !== undefined) row[key] = value;
            }
          },
        }),
      }),
      select: vi.fn(() => { throw new Error("Metadata patches must not read stale rows"); }),
    };
    const repository = createConversationRepository(db as unknown as AppDatabase);
    await Promise.all([
      repository.updateMetadata("chat", { selectedFileIds: [] }),
      repository.updateMetadata("chat", { title: "New" }),
    ]);
    expect(row.selectedFileIds).toEqual([]);
    expect(row.title).toBe("New");
    expect(db.select).not.toHaveBeenCalled();
  });
});
