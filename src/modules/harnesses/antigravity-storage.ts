import * as SecureStore from "expo-secure-store";

import {
  normalizeAntigravityUrl,
  type AntigravityConnection,
} from "./antigravity";

const KEY = "antigravity_harness_connection_v1";

export type SavedAntigravityConnection = AntigravityConnection;

// The bridge token belongs in SecureStore, never the app database or logs.
export async function loadAntigravityConnection(): Promise<SavedAntigravityConnection | null> {
  const raw = await SecureStore.getItemAsync(KEY);
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
    url: normalizeAntigravityUrl(connection.url, {
      allowInsecureLan: connection.allowInsecureLan === true,
    }),
    allowInsecureLan: connection.allowInsecureLan === true,
    token: connection.token,
    cwd: connection.cwd,
  };
}

export async function saveAntigravityConnection(
  connection: SavedAntigravityConnection,
) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(connection));
}

export async function forgetAntigravityConnection() {
  await SecureStore.deleteItemAsync(KEY);
}
