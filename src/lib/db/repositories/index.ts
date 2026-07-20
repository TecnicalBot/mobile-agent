import type { SQLiteDatabase } from "expo-sqlite";

import { createAgentRunRepository } from "@/lib/db/repositories/agent-run-repository";
import { createConfigRepository } from "@/lib/db/repositories/config-repository";
import { createConversationRepository } from "@/lib/db/repositories/conversation-repository";
import { createFileMemoryStore } from "@/lib/memory/file-memory-store";
import { createMcpServerRepository } from "@/lib/db/repositories/mcp-server-repository";
import { createMessageRepository } from "@/lib/db/repositories/message-repository";
import { createSkillRepository } from "@/lib/db/repositories/skill-repository";
import { createWorkspaceRepository } from "@/lib/db/repositories/workspace-repository";
import { createDrizzleDb } from "@/lib/db/repositories/shared";
import type { Repositories } from "@/lib/db/repositories/types";

export function createRepositories(sqliteDb: SQLiteDatabase): Repositories {
  const db = createDrizzleDb(sqliteDb);

  return {
    agentRunRepository: createAgentRunRepository(db),
    configRepository: createConfigRepository(db),
    conversationRepository: createConversationRepository(db),
    memoryStore: createFileMemoryStore(db),
    mcpServerRepository: createMcpServerRepository(db),
    messageRepository: createMessageRepository(db),
    skillRepository: createSkillRepository(db),
    workspaceRepository: createWorkspaceRepository(db),
  };
}
