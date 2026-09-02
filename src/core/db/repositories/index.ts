import type { SQLiteDatabase } from "expo-sqlite";

import { createAgentRepository } from "@/core/db/repositories/agent-repository";
import { createAgentRunRepository } from "@/core/db/repositories/agent-run-repository";
import { createConfigRepository } from "@/core/db/repositories/config-repository";
import { createConversationRepository } from "@/core/db/repositories/conversation-repository";
import { createFileMemoryStore } from "@/modules/memory/file-memory-store";
import { createMcpServerRepository } from "@/core/db/repositories/mcp-server-repository";
import { createMessageRepository } from "@/core/db/repositories/message-repository";
import { createProviderAccountRepository } from "@/core/db/repositories/provider-account-repository";
import { createSavedPromptRepository } from "@/core/db/repositories/saved-prompt-repository";
import { createScheduleRepository } from "@/core/db/repositories/schedule-repository";
import { createScheduleRunRepository } from "@/core/db/repositories/schedule-run-repository";
import { createSkillRepository } from "@/core/db/repositories/skill-repository";
import { createWorkspaceRepository } from "@/core/db/repositories/workspace-repository";
import { createDrizzleDb } from "@/core/db/repositories/shared";
import type { Repositories } from "@/core/db/repositories/types";

export function createRepositories(sqliteDb: SQLiteDatabase): Repositories {
  const db = createDrizzleDb(sqliteDb);

  return {
    agentRepository: createAgentRepository(db),
    agentRunRepository: createAgentRunRepository(db),
    configRepository: createConfigRepository(db),
    conversationRepository: createConversationRepository(db),
    memoryStore: createFileMemoryStore(db),
    mcpServerRepository: createMcpServerRepository(db),
    messageRepository: createMessageRepository(db),
    providerAccountRepository: createProviderAccountRepository(db),
    savedPromptRepository: createSavedPromptRepository(db),
    scheduleRepository: createScheduleRepository(db),
    scheduleRunRepository: createScheduleRunRepository(db),
    skillRepository: createSkillRepository(db),
    workspaceRepository: createWorkspaceRepository(db),
  };
}
