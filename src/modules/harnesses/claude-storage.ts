import {
  forgetAcpConnection,
  loadAcpConnection,
  saveAcpConnection,
  type SavedAcpConnection,
} from "./acp-storage";
import { CLAUDE_PROFILE } from "./acp-profile";

export type SavedClaudeConnection = SavedAcpConnection;

export function loadClaudeConnection(): Promise<SavedClaudeConnection | null> {
  return loadAcpConnection(CLAUDE_PROFILE);
}

export function saveClaudeConnection(connection: SavedClaudeConnection) {
  return saveAcpConnection(CLAUDE_PROFILE, connection);
}

export function forgetClaudeConnection() {
  return forgetAcpConnection(CLAUDE_PROFILE);
}
