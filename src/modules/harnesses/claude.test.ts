import { describe, expect, it, vi } from "vitest";

import { normalizeClaudeUrl } from "./claude";
import {
  ACP_AUTH_ERROR_PATTERN,
  ANTIGRAVITY_PROFILE,
  CLAUDE_PROFILE,
  acpModelRef,
} from "./acp-profile";
import {
  CLAUDE_PROVIDER_ID,
  claudeModelRef,
  presentClaudeModel,
} from "./claude-presentation";
import {
  applyAcpUpdate,
  createAcpSessionState,
  normalizeAcpAvailableCommands,
} from "./acp-presentation";
import { summarizeAcpAuthStatus } from "./acp-auth-status";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "test" } },
}));
vi.mock("expo/fetch", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) =>
    globalThis.fetch(...args),
}));

describe("Claude harness profile", () => {
  it("uses a distinct provider namespace, port, and secure-store key", () => {
    expect(CLAUDE_PROFILE).toMatchObject({
      id: "claude",
      providerId: "harness:claude",
      modelPrefix: "harness:claude/",
      defaultPort: 7802,
      bridgeDirectory: "claude-bridge",
    });
    expect(CLAUDE_PROFILE.storageKey).not.toBe(ANTIGRAVITY_PROFILE.storageKey);
  });

  it("encodes model IDs inside the Claude namespace", () => {
    expect(claudeModelRef("claude-sonnet-4-6")).toBe(
      "harness:claude/claude-sonnet-4-6",
    );
    expect(acpModelRef(CLAUDE_PROFILE, 'model/with space "quote"')).toBe(
      "harness:claude/model%2Fwith%20space%20%22quote%22",
    );
  });

  it("labels Claude models as a harness provider", () => {
    expect(presentClaudeModel({ modelId: "m", name: "Model" })).toMatchObject({
      providerId: "harness:claude",
      providerLabel: "Claude (Harness)",
      supportsTools: true,
      supportsReasoning: true,
    });
    expect(CLAUDE_PROVIDER_ID).toBe("harness:claude");
  });

  it("distinguishes agent sign-out from a rejected bridge token", () => {
    expect(ACP_AUTH_ERROR_PATTERN.test("Authentication required")).toBe(true);
    expect(ACP_AUTH_ERROR_PATTERN.test("Not logged in")).toBe(true);
    expect(ACP_AUTH_ERROR_PATTERN.test("Unauthorized")).toBe(false);
    expect(ACP_AUTH_ERROR_PATTERN.test("HTTP 401")).toBe(false);
  });
});

describe("Claude bridge URLs", () => {
  it("accepts loopback HTTP and HTTPS", () => {
    expect(normalizeClaudeUrl("http://127.0.0.1:7802")).toBe(
      "http://127.0.0.1:7802",
    );
    expect(normalizeClaudeUrl("https://claude.example.com")).toBe(
      "https://claude.example.com",
    );
  });

  it("requires explicit consent for plain HTTP on a LAN address", () => {
    expect(() => normalizeClaudeUrl("http://192.168.1.20:7802")).toThrow(
      /HTTPS/,
    );
    expect(
      normalizeClaudeUrl("http://192.168.1.20:7802", {
        allowInsecureLan: true,
      }),
    ).toBe("http://192.168.1.20:7802");
  });
});

describe("ACP host commands and auth status", () => {
  it("replaces the session command list with the adapter payload", () => {
    const state = createAcpSessionState(CLAUDE_PROFILE, {
      result: { sessionId: "session-1" },
      cwd: "/tmp/project",
    });
    const next = applyAcpUpdate(CLAUDE_PROFILE, state, {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        {
          name: "review",
          description: "Review the current changes",
          input: { hint: "[path]" },
        },
        { name: "review", description: "Duplicate" },
        { name: "bad name" },
        { name: "skill:deploy", _meta: { kind: "skill" } },
        null,
      ],
    });

    expect(next.commands.map((command) => command.name)).toEqual([
      "review",
      "skill:deploy",
    ]);
    expect(next.commands[0]).toMatchObject({
      description: "Review the current changes",
      input: { hint: "[path]" },
    });
    expect(next.commands[1]).toMatchObject({
      description: null,
      input: null,
      _meta: { kind: "skill" },
    });
  });

  it("drops malformed command payloads instead of crashing", () => {
    expect(normalizeAcpAvailableCommands(null)).toEqual([]);
    expect(normalizeAcpAvailableCommands({ name: "review" })).toEqual([]);
  });

  it("summarizes subscription and API-key identities", () => {
    expect(
      summarizeAcpAuthStatus({
        kind: "account",
        label: "Claude Max",
        account: { plan: "max", email: "person@example.com" },
      }),
    ).toMatchObject({
      label: "Plan",
      value: "Claude Max",
      detailLabel: "Signed in as",
      detail: "person@example.com",
      signedIn: true,
    });

    expect(
      summarizeAcpAuthStatus({
        kind: "api_key",
        label: "Anthropic API key",
        detail: "ANTHROPIC_API_KEY",
      }),
    ).toMatchObject({
      label: "Authentication",
      value: "Anthropic API key",
      detailLabel: "Source",
      detail: "ANTHROPIC_API_KEY",
      signedIn: true,
    });

    expect(
      summarizeAcpAuthStatus({ kind: "none", label: "Not logged in" }),
    ).toMatchObject({ signedIn: false });
    expect(summarizeAcpAuthStatus(null)).toBeNull();
  });
});
