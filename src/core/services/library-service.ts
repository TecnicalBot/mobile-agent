import type { SQLiteDatabase } from "expo-sqlite";

import { conversations, workspaceFileConversations } from "@/core/db/schema";
import { createDrizzleDb } from "@/core/db/repositories/shared";
import { createWorkspaceRepository } from "@/core/db/repositories/workspace-repository";
import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import { createLibraryCatalog, parseLibraryMetadata, type LibraryConversation, type LibraryMessage } from "@/modules/files/library-catalog";

export async function loadLibraryCatalog(
  sqlite: SQLiteDatabase,
  live?: { conversation: LibraryConversation; messages: LibraryMessage[] },
) {
  const db = createDrizzleDb(sqlite);
  const [files, chats, links] = await Promise.all([
    createWorkspaceRepository(db).list(),
    db.select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt }).from(conversations),
    db.select().from(workspaceFileConversations),
  ]);
  if (live && !chats.some((chat) => chat.id === live.conversation.id)) chats.push(live.conversation);
  const catalog = createLibraryCatalog(
    files.map((file) => ({ ...file, uri: resolveWorkspaceFile(file.relativePath).uri })),
    chats,
    links,
  );
  // Stream only rows that can name a local file; ordinary prose and traces are
  // skipped before their metadata is parsed into the JS heap.
  for await (const row of sqlite.getEachAsync<{
    conversation_id: string; content: string; metadata_json: string | null; created_at: string;
  }>(`SELECT conversation_id, content, metadata_json, created_at FROM messages
      WHERE content LIKE '%workspace://%'
         OR metadata_json LIKE '%workspace://%'
         OR metadata_json LIKE '%"selectedFileIds"%'
         OR metadata_json LIKE '%"generatedImages"%'
         OR metadata_json LIKE '%"generatedVideos"%'
         OR metadata_json LIKE '%"mediaResult"%'
         OR metadata_json LIKE '%"pluginOutputs"%'
         OR metadata_json LIKE '%"previewScene"%'
         OR metadata_json LIKE '%"getVideoFrame"%'
      ORDER BY created_at`)) {
    catalog.addMessage({
      conversationId: row.conversation_id,
      content: row.content,
      metadata: parseLibraryMetadata(row.metadata_json),
      createdAt: row.created_at,
    });
  }
  for (const message of live?.messages ?? []) {
    catalog.addMessage({ ...message, conversationId: live!.conversation.id });
  }
  return catalog.finish();
}
