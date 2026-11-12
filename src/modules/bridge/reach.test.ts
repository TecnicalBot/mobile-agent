import { describe, expect, it } from "vitest";
import {
  bridgeUrl,
  bridgeUrls,
  classifyBridgeAddress,
  isAllowedBridgeHost,
  isAllowedBridgeSource,
  isLoopbackAddress,
  isPrivateAddress,
  isTailnetAddress,
  normalizeBridgeAddress,
  selectReach,
  type BridgeInterface,
} from "./reach";

const wifi: BridgeInterface = {
  name: "wlan0",
  address: "192.168.1.5",
  family: "ipv4",
};
const tailnet: BridgeInterface = {
  name: "tun0",
  address: "100.101.102.103",
  family: "ipv4",
};
const cellular: BridgeInterface = {
  name: "rmnet0",
  address: "10.44.1.9",
  family: "ipv4",
};

describe("address classification", () => {
  it("recognises loopback, private, and tailnet addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("localhost")).toBe(true);
    expect(isLoopbackAddress("LOCALHOST")).toBe(true);
    expect(isLoopbackAddress("localhost.")).toBe(true);
    expect(isLoopbackAddress("192.168.1.5")).toBe(false);
    expect(isPrivateAddress("192.168.1.5")).toBe(true);
    expect(isPrivateAddress("10.0.0.2")).toBe(true);
    expect(isPrivateAddress("172.16.4.4")).toBe(true);
    expect(isPrivateAddress("172.32.4.4")).toBe(false);
    expect(isTailnetAddress("100.64.0.1")).toBe(true);
    expect(isTailnetAddress("100.127.255.254")).toBe(true);
    expect(isTailnetAddress("100.128.0.1")).toBe(false);
  });

  it("normalizes manual addresses and classifies their reach", () => {
    expect(normalizeBridgeAddress("localhost")).toBe("localhost");
    expect(normalizeBridgeAddress("http://192.168.1.20:43877/mcp")).toBe(
      "192.168.1.20",
    );
    expect(normalizeBridgeAddress("[::1]:43877")).toBe("[::1]");
    expect(normalizeBridgeAddress("::1")).toBe("[::1]");
    expect(normalizeBridgeAddress("http://localhost:43877/mcp")).toBe(
      "localhost",
    );
    expect(normalizeBridgeAddress("attacker.example")).toBeNull();
    expect(normalizeBridgeAddress("http://user:pass@192.168.1.20")).toBeNull();

    expect(classifyBridgeAddress("localhost")).toEqual({ reach: "loopback" });
    expect(classifyBridgeAddress("127.0.0.1")).toEqual({ reach: "loopback" });
    expect(classifyBridgeAddress("192.168.1.20")).toEqual({
      reach: "lan",
      address: "192.168.1.20",
    });
    expect(classifyBridgeAddress("100.88.1.2")).toEqual({
      reach: "tailnet",
      address: "100.88.1.2",
    });
    expect(classifyBridgeAddress("8.8.8.8")).toBeNull();
  });

  it("brackets IPv6 hosts when building a bridge URL", () => {
    expect(bridgeUrl("[::1]", 43877)).toBe("http://[::1]:43877/mcp");
  });
});

describe("reach selection", () => {
  const interfaces = [cellular, wifi, tailnet];

  it("stays on loopback for a harness on this phone", () => {
    expect(
      selectReach({
        harnessUrl: "http://127.0.0.1:4096",
        interfaces,
        port: 43877,
      }),
    ).toMatchObject({
      reach: "loopback",
      url: "http://127.0.0.1:43877/mcp",
      needsOverride: false,
    });
    expect(
      selectReach({
        harnessUrl: "http://localhost:4096",
        interfaces,
        port: 43877,
      }),
    ).toMatchObject({
      reach: "loopback",
      url: "http://127.0.0.1:43877/mcp",
      needsOverride: false,
    });
  });

  it("advertises the interface on the harness subnet", () => {
    expect(
      selectReach({
        harnessUrl: "http://192.168.1.20:4096",
        interfaces,
        port: 43877,
      }),
    ).toMatchObject({
      reach: "lan",
      address: "192.168.1.5",
      url: "http://192.168.1.5:43877/mcp",
      needsOverride: false,
    });
  });

  it("flags a routed LAN harness instead of guessing", () => {
    expect(
      selectReach({
        harnessUrl: "http://192.168.9.20:4096",
        interfaces,
        port: 43877,
      }),
    ).toMatchObject({ reach: "lan", needsOverride: true });
  });

  it("prefers a physical link over a corporate VPN", () => {
    const vpn: BridgeInterface = {
      name: "tun0",
      address: "10.8.0.2",
      family: "ipv4",
    };
    expect(
      selectReach({
        harnessUrl: "http://10.9.0.5:4096",
        interfaces: [vpn, wifi],
        port: 43877,
      }),
    ).toMatchObject({
      reach: "lan",
      address: "192.168.1.5",
      needsOverride: true,
    });
  });

  it("uses the tailnet address when the harness is on the tailnet", () => {
    expect(
      selectReach({
        harnessUrl: "http://100.88.1.2:4096",
        interfaces,
        port: 43877,
      }),
    ).toMatchObject({
      reach: "tailnet",
      address: "100.101.102.103",
      needsOverride: false,
    });
  });

  it("falls back to LAN when the harness is on the tailnet but the phone is not", () => {
    expect(
      selectReach({
        harnessUrl: "http://100.88.1.2:4096",
        interfaces: [cellular, wifi],
        port: 43877,
      }),
    ).toMatchObject({ reach: "lan", address: "192.168.1.5", needsOverride: true });
  });

  it("prefers the tailnet for a remote harness", () => {
    expect(
      selectReach({
        harnessUrl: "https://desk.example.com",
        interfaces,
        port: 43877,
      }),
    ).toMatchObject({ reach: "tailnet", address: "100.101.102.103" });
  });

  it("honours an explicit preference and degrades when it disappears", () => {
    expect(
      selectReach({
        harnessUrl: "http://192.168.1.20:4096",
        interfaces,
        port: 43877,
        preference: "tailnet",
      }),
    ).toMatchObject({ reach: "tailnet" });
    expect(
      selectReach({
        harnessUrl: "http://192.168.1.20:4096",
        interfaces: [wifi],
        port: 43877,
        preference: "tailnet",
      }),
    ).toMatchObject({ reach: "lan", address: "192.168.1.5" });
  });

  it("stays on loopback until a harness is known", () => {
    expect(selectReach({ interfaces, port: 43877 })).toMatchObject({
      reach: "loopback",
    });
  });
});

describe("advertised URLs", () => {
  it("lists every reachable address without inventing one", () => {
    expect(bridgeUrls([wifi, tailnet], 43877)).toEqual({
      loopback: "http://127.0.0.1:43877/mcp",
      lan: "http://192.168.1.5:43877/mcp",
      tailnet: "http://100.101.102.103:43877/mcp",
    });
    expect(bridgeUrls([cellular], 43877)).toEqual({
      loopback: "http://127.0.0.1:43877/mcp",
      lan: undefined,
      tailnet: undefined,
    });
  });
});

describe("request validation", () => {
  it("accepts IP literals and localhost only", () => {
    expect(isAllowedBridgeHost("localhost")).toBe(true);
    expect(isAllowedBridgeHost("127.0.0.1")).toBe(true);
    expect(isAllowedBridgeHost("192.168.1.5")).toBe(true);
    expect(isAllowedBridgeHost("[::1]")).toBe(true);
    expect(isAllowedBridgeHost("attacker.example")).toBe(false);
    expect(isAllowedBridgeHost("phone.local")).toBe(false);
  });

  it("limits sources by reach", () => {
    expect(isAllowedBridgeSource("loopback", "127.0.0.1")).toBe(true);
    expect(isAllowedBridgeSource("loopback", "192.168.1.20")).toBe(false);
    expect(isAllowedBridgeSource("lan", "192.168.1.20")).toBe(true);
    expect(isAllowedBridgeSource("lan", "100.88.1.2")).toBe(true);
    expect(isAllowedBridgeSource("lan", "203.0.113.9")).toBe(false);
    expect(isAllowedBridgeSource("tailnet", "100.88.1.2")).toBe(true);
    expect(isAllowedBridgeSource("tailnet", "127.0.0.1")).toBe(true);
    expect(isAllowedBridgeSource("tailnet", "192.168.1.20")).toBe(false);
  });
});
