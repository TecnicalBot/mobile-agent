import * as SecureStore from "expo-secure-store";

import { normalizeOpenCodeUrl, type OpenCodeConnection } from "./opencode";

const KEY = "opencode_harness_connection_v1";

export type SavedOpenCodeConnection = OpenCodeConnection & {
  sessionID?: string;
};

// The connection password belongs in SecureStore, never the app database or logs.
export async function loadOpenCodeConnection(): Promise<SavedOpenCodeConnection | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return null;
  const connection = value as Record<string, unknown>;
  if (
    typeof connection.url !== "string" ||
    typeof connection.password !== "string" ||
    typeof connection.username !== "string" ||
    typeof connection.directory !== "string"
  )
    return null;
  return {
    url: normalizeOpenCodeUrl(connection.url, {
      allowInsecureLan: connection.allowInsecureLan === true,
    }),
    allowInsecureLan: connection.allowInsecureLan === true,
    password: connection.password,
    username: connection.username,
    directory: connection.directory,
    sessionID:
      typeof connection.sessionID === "string"
        ? connection.sessionID
        : undefined,
  };
}

export async function saveOpenCodeConnection(
  connection: SavedOpenCodeConnection,
) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(connection));
}

export async function forgetOpenCodeConnection() {
  await SecureStore.deleteItemAsync(KEY);
}
