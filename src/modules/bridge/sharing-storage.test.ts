import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadBridgeSharing,
  saveBridgeSharing,
  type SavedBridgeSharing,
} from "./sharing-storage";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

const saved: SavedBridgeSharing = {
  version: 1,
  reach: "lan",
  grant: { workspace: true, skills: true, folder: null },
};
beforeEach(() => store.clear());

describe("device sharing resume settings", () => {
  it("restores exactly the granted capabilities and network after a module reload", async () => {
    await saveBridgeSharing(saved);
    vi.resetModules();
    const reloaded = await import("./sharing-storage");
    expect(await reloaded.loadBridgeSharing()).toEqual(saved);
  });
  it("retains an Android folder grant without expanding its scope", async () => {
    const folder = {
      uri: "content://provider/tree/granted",
      platform: "android" as const,
      sourceType: "external-folder" as const,
      displayName: "Shared",
      grantedAt: "2026-10-29",
    };
    await saveBridgeSharing({
      ...saved,
      grant: { workspace: false, skills: false, folder },
    });
    expect((await loadBridgeSharing())?.grant).toEqual({
      workspace: false,
      skills: false,
      folder,
    });
  });
  it("does not resume sharing that was explicitly stopped or revoked", async () => {
    await saveBridgeSharing(saved);
    await saveBridgeSharing(null);
    expect(await loadBridgeSharing()).toBeNull();
  });
  it("preserves write order when Stop races with an earlier Start", async () => {
    await Promise.all([saveBridgeSharing(saved), saveBridgeSharing(null)]);
    expect(await loadBridgeSharing()).toBeNull();
  });
  it.each([
    "not-json",
    JSON.stringify({ ...saved, version: 99 }),
    JSON.stringify({
      ...saved,
      grant: { workspace: "true", skills: false, folder: null },
    }),
    JSON.stringify({
      ...saved,
      grant: { workspace: false, skills: false, folder: null },
    }),
    JSON.stringify({
      ...saved,
      grant: { ...saved.grant, folder: { uri: "file:///ungranted" } },
    }),
  ])("fails closed for invalid saved data", async (raw) => {
    store.set("phone_bridge_sharing_v1", raw);
    expect(await loadBridgeSharing()).toBeNull();
  });
});
