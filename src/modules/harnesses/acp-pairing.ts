import { fetch as expoFetch } from "expo/fetch";

import { normalizeAcpUrl } from "./acp-client";
import type { AcpHarnessID } from "./acp-profile";

export const ACP_PAIRING_TYPE = "mobile-agent-acp-pair";

export type AcpPairingEntry = {
  id: AcpHarnessID;
  url: string;
  code: string;
};

export type AcpPairingPayload = {
  v: 1;
  type: typeof ACP_PAIRING_TYPE;
  name?: string;
  issuedAt?: number;
  expiresAt?: number;
  bridges: AcpPairingEntry[];
};

const HARNESS_IDS = new Set<AcpHarnessID>(["antigravity", "claude"]);
const PAIRING_CODE = /^[A-Za-z0-9_-]{8,128}$/;

function finiteTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * A scanned QR is untrusted input. Accept only the payload emitted by the
 * bridge's `--pair` mode, and normalize every URL before it can be used.
 */
export function parseAcpPairingPayload(
  value: string,
  options?: { now?: number },
): AcpPairingPayload {
  const input = value.trim();
  if (!input.startsWith("{")) {
    throw new Error("Scan the pairing QR shown by `mabridge`.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("That QR code is not a valid Mobile Agent pairing code.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("That QR code is not a Mobile Agent pairing code.");
  }

  const payload = parsed as Record<string, unknown>;
  if (payload.v !== 1 || payload.type !== ACP_PAIRING_TYPE) {
    throw new Error("That QR code is not a Mobile Agent pairing code.");
  }

  const expiresAt = finiteTimestamp(payload.expiresAt);
  if (payload.expiresAt !== undefined && expiresAt === null) {
    throw new Error("The pairing QR has an invalid expiry.");
  }
  if (expiresAt && expiresAt <= (options?.now ?? Date.now())) {
    throw new Error("This pairing QR has expired. Run `mabridge` again.");
  }

  const rawBridges = payload.bridges;
  if (!Array.isArray(rawBridges) || rawBridges.length === 0) {
    throw new Error("The pairing QR does not include a bridge.");
  }
  if (rawBridges.length > 8) {
    throw new Error("The pairing QR includes too many bridges.");
  }

  const seen = new Set<AcpHarnessID>();
  const bridges: AcpPairingEntry[] = rawBridges.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("The pairing QR has an invalid bridge entry.");
    }
    const bridge = raw as Record<string, unknown>;
    if (
      typeof bridge.id !== "string" ||
      !HARNESS_IDS.has(bridge.id as AcpHarnessID)
    ) {
      throw new Error("The pairing QR includes an unsupported harness.");
    }
    const id = bridge.id as AcpHarnessID;
    if (seen.has(id)) {
      throw new Error("The pairing QR includes the same harness twice.");
    }
    seen.add(id);
    if (typeof bridge.url !== "string" || !bridge.url.trim()) {
      throw new Error("The pairing QR has a missing bridge URL.");
    }
    if (typeof bridge.code !== "string" || !PAIRING_CODE.test(bridge.code)) {
      throw new Error("The pairing QR has an invalid pairing code.");
    }
    return {
      id,
      url: normalizeAcpUrl(bridge.url, { allowInsecureLan: true }),
      code: bridge.code,
    };
  });

  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : undefined;

  return {
    v: 1,
    type: ACP_PAIRING_TYPE,
    ...(name ? { name } : {}),
    ...(finiteTimestamp(payload.issuedAt)
      ? { issuedAt: finiteTimestamp(payload.issuedAt) as number }
      : {}),
    ...(expiresAt ? { expiresAt } : {}),
    bridges,
  };
}

/**
 * Exchange a single-use QR code for the bridge's stable token. The code is
 * intentionally redeemed over the same HTTP(S) endpoint the app will use.
 */
export async function redeemAcpPairing(
  entry: AcpPairingEntry,
  options?: {
    signal?: AbortSignal;
    transport?: typeof globalThis.fetch;
  },
): Promise<string> {
  if (!PAIRING_CODE.test(entry.code)) {
    throw new Error("Invalid pairing code.");
  }
  const url = normalizeAcpUrl(entry.url, { allowInsecureLan: true });
  const transport =
    options?.transport ?? (expoFetch as typeof globalThis.fetch);
  const response = await transport(`${url}/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: entry.code }),
    redirect: "error",
    signal: options?.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Pairing failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token.trim()) {
    throw new Error("The bridge did not return a token.");
  }
  return body.token.trim();
}
