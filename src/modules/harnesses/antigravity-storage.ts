import {
  forgetAcpConnection,
  loadAcpConnection,
  saveAcpConnection,
  type SavedAcpConnection,
} from "./acp-storage";
import { ANTIGRAVITY_PROFILE } from "./acp-profile";

export type SavedAntigravityConnection = SavedAcpConnection;

export function loadAntigravityConnection(): Promise<SavedAntigravityConnection | null> {
  return loadAcpConnection(ANTIGRAVITY_PROFILE);
}

export function saveAntigravityConnection(
  connection: SavedAntigravityConnection,
) {
  return saveAcpConnection(ANTIGRAVITY_PROFILE, connection);
}

export function forgetAntigravityConnection() {
  return forgetAcpConnection(ANTIGRAVITY_PROFILE);
}
