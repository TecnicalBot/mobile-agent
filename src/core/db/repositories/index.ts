import { createAgentRepository } from "@/core/db/repositories/agent-repository";
import { createAgentRunRepository } from "@/core/db/repositories/agent-run-repository";
import { createConfigRepository } from "@/core/db/repositories/config-repository";
import { createConversationRepository } from "@/core/db/repositories/conversation-repository";
import { createMcpServerRepository } from "@/core/db/repositories/mcp-server-repository";
import { createMessageRepository } from "@/core/db/repositories/message-repository";
import { createPluginRepository } from "@/core/db/repositories/plugin-repository";
import { createProviderAccountRepository } from "@/core/db/repositories/provider-account-repository";
import { createSavedPromptRepository } from "@/core/db/repositories/saved-prompt-repository";
import { createScheduleRepository } from "@/core/db/repositories/schedule-repository";
import { createScheduleRunRepository } from "@/core/db/repositories/schedule-run-repository";
import { createSkillRepository } from "@/core/db/repositories/skill-repository";
import { createWorkspaceRepository } from "@/core/db/repositories/workspace-repository";
import type {
  AppDatabase,
  Repositories,
} from "@/core/db/repositories/types";
import type { MemoryStore } from "@/modules/memory/types";

/**
 * Builds the repository set from an already-constructed Drizzle handle.
 *
 * The driver is chosen by the caller, which is what keeps this module free of
 * native imports: Android/iOS pass a `drizzle-orm/expo-sqlite` handle, while the
 * Electron renderer and main process pass a `drizzle-orm/sqlite-proxy` handle.
 *
 * `memoryStore` is likewise injected, because the default implementation is
 * backed by `expo-file-system` and cannot be reached from a non-Expo host.
 */
export function createRepositories(
  db: AppDatabase,
  memoryStore: MemoryStore,
): Repositories {
  return {
    agentRepository: createAgentRepository(db),
    agentRunRepository: createAgentRunRepository(db),
    configRepository: createConfigRepository(db),
    conversationRepository: createConversationRepository(db),
    memoryStore,
    mcpServerRepository: createMcpServerRepository(db),
    messageRepository: createMessageRepository(db),
    pluginRepository: createPluginRepository(db),
    providerAccountRepository: createProviderAccountRepository(db),
    savedPromptRepository: createSavedPromptRepository(db),
    scheduleRepository: createScheduleRepository(db),
    scheduleRunRepository: createScheduleRunRepository(db),
    skillRepository: createSkillRepository(db),
    workspaceRepository: createWorkspaceRepository(db),
  };
}
