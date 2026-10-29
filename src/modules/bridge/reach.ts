/**
 * Where the phone bridge is reachable from, and how to advertise it.
 *
 * A harness on the phone itself uses loopback. A harness on another device needs
 * an address that device can route to: the tailnet address when both are on a
 * tailnet, otherwise the LAN address. Nothing here guesses silently: when the
 * harness address cannot be matched to a local interface the caller gets
 * `needsOverride` and the UI asks for an address.
 */
export type BridgeReach = "loopback" | "tailnet" | "lan";

export type BridgeInterface = {
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
};

export type BridgeUrls = {
  loopback: string;
  lan?: string;
  tailnet?: string;
};

function ipv4Parts(address: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

export function isLoopbackAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized === "::1") return true;
  const parts = ipv4Parts(normalized.replace(/^::ffff:/, ""));
  return Boolean(parts && parts[0] === 127);
}

/** Tailscale assigns node addresses from the CGNAT range, and they stay stable. */
export function isTailnetAddress(address: string) {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function isPrivateAddress(address: string) {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Hosts the bridge answers to: IP literals only, never DNS names. */
export function isAllowedBridgeHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  if (host.startsWith("[") && host.endsWith("]")) return host.length > 2;
  if (ipv4Parts(host)) return true;
  // A bare IPv6 literal is not valid in a Host header without brackets.
  return false;
}

/** Sources allowed to open a connection for a given reach. */
export function isAllowedBridgeSource(reach: BridgeReach, address: string) {
  const source = address.split("%")[0].replace(/^::ffff:/, "");
  if (isLoopbackAddress(source)) return true;
  if (reach === "loopback") return false;
  if (reach === "tailnet") return isTailnetAddress(source);
  return isPrivateAddress(source) || isTailnetAddress(source);
}

export function bridgeUrl(address: string, port: number) {
  return `http://${address}:${port}/mcp`;
}

/** Cellular interfaces are never advertised: they are not reachable from a LAN. */
export function isCellularInterfaceName(name: string) {
  return /^(rmnet|ccmni|radio|pdp|wwan|v4-rmnet)/i.test(name);
}

/** Physical links first, then VPNs: a corporate tun should not win by chance. */
function interfaceRank(item: BridgeInterface) {
  if (/^(wlan|ap|swlan|eth)/i.test(item.name)) return 0;
  if (isTailnetAddress(item.address)) return 1;
  if (/^(tun|ppp|wg)/i.test(item.name)) return 2;
  return 3;
}

function usableInterfaces(interfaces: BridgeInterface[]) {
  return interfaces
    .filter(
      (item) => item.family === "ipv4" && !isCellularInterfaceName(item.name),
    )
    .sort((left, right) => interfaceRank(left) - interfaceRank(right));
}

export function bridgeUrls(
  interfaces: BridgeInterface[],
  port: number,
): BridgeUrls {
  const ipv4 = usableInterfaces(interfaces);
  const tailnet = ipv4.find((item) => isTailnetAddress(item.address));
  const lan = ipv4.find((item) => isPrivateAddress(item.address));
  return {
    loopback: bridgeUrl("127.0.0.1", port),
    lan: lan ? bridgeUrl(lan.address, port) : undefined,
    tailnet: tailnet ? bridgeUrl(tailnet.address, port) : undefined,
  };
}

function sameSubnet(left: string, right: string) {
  const a = ipv4Parts(left);
  const b = ipv4Parts(right);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export type ReachSelection = {
  reach: BridgeReach;
  /** Interface address to advertise, absent for loopback. */
  address?: string;
  url: string;
  /** The harness could not be matched to a local interface; ask the user. */
  needsOverride: boolean;
};

export function selectReach(input: {
  harnessUrl?: string | null;
  interfaces: BridgeInterface[];
  port: number;
  preference?: BridgeReach | "auto";
}): ReachSelection {
  const { harnessUrl, interfaces, port } = input;
  const ipv4 = usableInterfaces(interfaces);
  const tailnet = ipv4.find((item) => isTailnetAddress(item.address));
  const lan = ipv4.find((item) => isPrivateAddress(item.address));

  const loopback: ReachSelection = {
    reach: "loopback",
    url: bridgeUrl("127.0.0.1", port),
    needsOverride: false,
  };

  if (input.preference && input.preference !== "auto") {
    if (input.preference === "loopback") return loopback;
    const match =
      input.preference === "tailnet"
        ? tailnet
        : ipv4.find(
            (item) =>
              isPrivateAddress(item.address) || isTailnetAddress(item.address),
          );
    if (match)
      return {
        reach: input.preference,
        address: match.address,
        url: bridgeUrl(match.address, port),
        needsOverride: false,
      };
    // The preferred interface is gone (Wi-Fi dropped, Tailscale off).
    return lan || tailnet
      ? {
          reach: "lan",
          address: (lan ?? tailnet)!.address,
          url: bridgeUrl((lan ?? tailnet)!.address, port),
          needsOverride: false,
        }
      : loopback;
  }

  if (!harnessUrl) return loopback;
  let hostname: string;
  try {
    hostname = new URL(harnessUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return loopback;
  }
  if (isLoopbackAddress(hostname)) return loopback;

  if (isTailnetAddress(hostname)) {
    if (tailnet)
      return {
        reach: "tailnet",
        address: tailnet.address,
        url: bridgeUrl(tailnet.address, port),
        needsOverride: false,
      };
    if (lan)
      return {
        reach: "lan",
        address: lan.address,
        url: bridgeUrl(lan.address, port),
        needsOverride: true,
      };
    return loopback;
  }

  if (isPrivateAddress(hostname)) {
    const match = ipv4.find((item) => sameSubnet(item.address, hostname));
    if (match)
      return {
        reach: "lan",
        address: match.address,
        url: bridgeUrl(match.address, port),
        needsOverride: false,
      };
    if (lan)
      return {
        reach: "lan",
        address: lan.address,
        url: bridgeUrl(lan.address, port),
        needsOverride: true,
      };
    return loopback;
  }

  // A remote harness URL: the tailnet is the only address that works everywhere.
  if (tailnet)
    return {
      reach: "tailnet",
      address: tailnet.address,
      url: bridgeUrl(tailnet.address, port),
      needsOverride: false,
    };
  if (lan)
    return {
      reach: "lan",
      address: lan.address,
      url: bridgeUrl(lan.address, port),
      needsOverride: true,
    };
  return loopback;
}
