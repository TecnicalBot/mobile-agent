import * as SecureStore from "expo-secure-store";

import { normalizeAcpUrl, type AcpConnection } from "./acp-client";
import type { AcpHarnessProfile } from "./acp-profile";

export type SavedAcpConnection = AcpConnection;

/**
 * One bridge token can serve every ACP harness on the host. Keep a shared copy
 * so a new harness form can prefill the token the user already entered instead
 * of asking for it twice.
 */
const SHARED_TOKEN_KEY = "acp_bridge_token_v1";

export async function loadSharedAcpToken(): Promise<string> {
  return (await SecureStore.getItemAsync(SHARED_TOKEN_KEY))?.trim() ?? "";
}

async function saveSharedAcpToken(token: string) {
  const value = token.trim();
  if (value) await SecureStore.setItemAsync(SHARED_TOKEN_KEY, value);
}

// The bridge token belongs in SecureStore, never the app database or logs.
export async function loadAcpConnection(
  profile: AcpHarnessProfile,
): Promise<SavedAcpConnection | null> {
  const raw = await SecureStore.getItemAsync(profile.storageKey);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return null;
  const connection = value as Record<string, unknown>;
  if (
    typeof connection.url !== "string" ||
    typeof connection.token !== "string" ||
    typeof connection.cwd !== "string"
  )
    return null;
  const token =
    connection.token.trim() || (await loadSharedAcpToken());
  return {
    url: normalizeAcpUrl(connection.url, {
      allowInsecureLan: connection.allowInsecureLan === true,
    }),
    allowInsecureLan: connection.allowInsecureLan === true,
    token,
    cwd: connection.cwd,
  };
}

export async function saveAcpConnection(
  profile: AcpHarnessProfile,
  connection: SavedAcpConnection,
) {
  await SecureStore.setItemAsync(
    profile.storageKey,
    JSON.stringify(connection),
  );
  await saveSharedAcpToken(connection.token);
}

export async function forgetAcpConnection(profile: AcpHarnessProfile) {
  await SecureStore.deleteItemAsync(profile.storageKey);
}
