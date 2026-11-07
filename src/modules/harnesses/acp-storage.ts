import * as SecureStore from "expo-secure-store";

import { normalizeAcpUrl, type AcpConnection } from "./acp-client";
import type { AcpHarnessProfile } from "./acp-profile";

export type SavedAcpConnection = AcpConnection;

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
  return {
    url: normalizeAcpUrl(connection.url, {
      allowInsecureLan: connection.allowInsecureLan === true,
    }),
    allowInsecureLan: connection.allowInsecureLan === true,
    token: connection.token,
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
}

export async function forgetAcpConnection(profile: AcpHarnessProfile) {
  await SecureStore.deleteItemAsync(profile.storageKey);
}
