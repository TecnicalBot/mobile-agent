import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetAcpConnection,
  loadAcpConnection,
  loadSharedAcpToken,
  saveAcpConnection,
} from "./acp-storage";
import { ANTIGRAVITY_PROFILE, CLAUDE_PROFILE } from "./acp-profile";

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
vi.mock("./acp-client", () => ({
  normalizeAcpUrl: (value: string) => value.trim().replace(/\/$/, ""),
}));

beforeEach(() => store.clear());

describe("ACP bridge connection storage", () => {
  it("reuses one bridge token across harnesses", async () => {
    await saveAcpConnection(ANTIGRAVITY_PROFILE, {
      url: "http://192.168.1.20:7801",
      token: "shared-token",
      cwd: "",
      allowInsecureLan: true,
    });
    await saveAcpConnection(CLAUDE_PROFILE, {
      url: "http://192.168.1.20:7802",
      token: "",
      cwd: "",
      allowInsecureLan: true,
    });

    expect(await loadSharedAcpToken()).toBe("shared-token");
    expect((await loadAcpConnection(CLAUDE_PROFILE))?.token).toBe(
      "shared-token",
    );
    expect((await loadAcpConnection(ANTIGRAVITY_PROFILE))?.token).toBe(
      "shared-token",
    );
  });

  it("keeps the shared token when one harness is forgotten", async () => {
    await saveAcpConnection(ANTIGRAVITY_PROFILE, {
      url: "http://192.168.1.20:7801",
      token: "shared-token",
      cwd: "",
      allowInsecureLan: true,
    });

    await forgetAcpConnection(ANTIGRAVITY_PROFILE);

    expect(await loadAcpConnection(ANTIGRAVITY_PROFILE)).toBeNull();
    expect(await loadSharedAcpToken()).toBe("shared-token");
  });
});
