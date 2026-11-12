import { describe, expect, it, vi } from "vitest";

import {
  ACP_PAIRING_TYPE,
  parseAcpPairingPayload,
  redeemAcpPairing,
  type AcpPairingEntry,
} from "./acp-pairing";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "test" } },
}));
vi.mock("expo/fetch", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) =>
    globalThis.fetch(...args),
}));

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    type: ACP_PAIRING_TYPE,
    name: "studio",
    issuedAt: 1_760_000_000_000,
    expiresAt: Date.now() + 60_000,
    bridges: [
      {
        id: "antigravity",
        url: "http://192.168.1.20:7801/",
        code: "abcdefghijklmnopqrstuvwx",
      },
      {
        id: "claude",
        url: "http://192.168.1.20:7802",
        code: "zyxwvutsrqponmlkjihgfedc",
      },
    ],
    ...overrides,
  });
}

describe("ACP pairing QR payloads", () => {
  it("parses and normalizes a combined bridge QR", () => {
    const parsed = parseAcpPairingPayload(payload());

    expect(parsed).toMatchObject({
      v: 1,
      type: ACP_PAIRING_TYPE,
      name: "studio",
      bridges: [
        { id: "antigravity", url: "http://192.168.1.20:7801" },
        { id: "claude", url: "http://192.168.1.20:7802" },
      ],
    });
  });

  it("resolves localhost bridge URLs to the IPv4 loopback address", () => {
    const parsed = parseAcpPairingPayload(
      payload({
        bridges: [
          {
            id: "antigravity",
            url: "http://localhost:7801",
            code: "abcdefgh",
          },
        ],
      }),
    );
    expect(parsed.bridges[0]?.url).toBe("http://127.0.0.1:7801");
  });

  it("rejects expired and malformed QR codes", () => {
    expect(() =>
      parseAcpPairingPayload(payload({ expiresAt: Date.now() - 1 })),
    ).toThrow(/expired/i);
    expect(() => parseAcpPairingPayload("not json")).toThrow(/pairing QR/i);
    expect(() => parseAcpPairingPayload("{}")).toThrow(/not a Mobile Agent/i);
    expect(() =>
      parseAcpPairingPayload(payload({ type: "something-else" })),
    ).toThrow(/not a Mobile Agent/i);
  });

  it("rejects unsupported harnesses, duplicate bridges, and unsafe URLs", () => {
    expect(() =>
      parseAcpPairingPayload(
        payload({
          bridges: [
            { id: "other", url: "http://192.168.1.20:1", code: "abcdefgh" },
          ],
        }),
      ),
    ).toThrow(/unsupported harness/i);
    expect(() =>
      parseAcpPairingPayload(
        payload({
          bridges: [
            {
              id: "antigravity",
              url: "http://192.168.1.20:7801",
              code: "abcdefgh",
            },
            {
              id: "antigravity",
              url: "http://192.168.1.20:7802",
              code: "ijklmnop",
            },
          ],
        }),
      ),
    ).toThrow(/same harness twice/i);
    expect(() =>
      parseAcpPairingPayload(
        payload({
          bridges: [
            {
              id: "claude",
              url: "http://example.com:7802",
              code: "abcdefgh",
            },
          ],
        }),
      ),
    ).toThrow(/HTTPS/);
  });
});

describe("ACP pairing redemption", () => {
  const entry: AcpPairingEntry = {
    id: "antigravity",
    url: "http://192.168.1.20:7801",
    code: "abcdefghijklmnopqrstuvwx",
  };

  it("exchanges a one-time code for the stable bridge token", async () => {
    const transport = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: " shared-token " }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      redeemAcpPairing(entry, { transport: transport as never }),
    ).resolves.toBe("shared-token");
    expect(transport).toHaveBeenCalledWith(
      "http://192.168.1.20:7801/pair/redeem",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: entry.code }),
      }),
    );
  });

  it("surfaces bridge rejection and empty-token responses", async () => {
    const rejected = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "expired" }), { status: 401 }),
    );
    await expect(
      redeemAcpPairing(entry, { transport: rejected as never }),
    ).rejects.toThrow(/Pairing failed \(401\)/);

    const empty = vi.fn(
      async () => new Response(JSON.stringify({ token: "" }), { status: 200 }),
    );
    await expect(
      redeemAcpPairing(entry, { transport: empty as never }),
    ).rejects.toThrow(/did not return a token/i);
  });
});
