import { Directory, File, Paths } from "expo-file-system";
import { desc, isNull } from "drizzle-orm";

import { memories } from "@/lib/db/schema";
import { nowIso } from "@/lib/db/repositories/shared";
import type { AppDatabase } from "@/lib/db/repositories/types";
import type { MemoryStore } from "@/lib/memory/types";
import type { MemoryEntry } from "@/types/app-state";

const MEMORY_ID = "memory.md";
const EMPTY_MEMORY_DOCUMENT = "# Memory\n";

function getMemoryDirectory() {
  return new Directory(Paths.document, "mobile-agent");
}

function getMemoryFile() {
  return new File(getMemoryDirectory(), MEMORY_ID);
}

function ensureMemoryDirectory() {
  const directory = getMemoryDirectory();

  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
}

function normalizeMemoryDocument(content: string) {
  const trimmed = content.trim();
  return trimmed ? `${trimmed}\n` : EMPTY_MEMORY_DOCUMENT;
}

function toMemoryEntry(file: File, content: string): MemoryEntry {
  const now = Date.now();

  return {
    id: MEMORY_ID,
    content,
    enabled: true,
    sourceConversationId: null,
    sourceMessageId: null,
    createdAt: new Date(
      file.creationTime ?? file.lastModified ?? now,
    ).toISOString(),
    updatedAt: new Date(file.lastModified ?? now).toISOString(),
    archivedAt: null,
  };
}

export function createFileMemoryStore(db: AppDatabase): MemoryStore {
  let migrationPromise: Promise<void> | null = null;

  async function migrateLegacyMemories() {
    const file = getMemoryFile();

    if (file.exists) {
      return;
    }

    const legacyMemories = await db
      .select()
      .from(memories)
      .where(isNull(memories.archivedAt))
      .orderBy(desc(memories.updatedAt));

    if (legacyMemories.length === 0) {
      return;
    }

    ensureMemoryDirectory();
    file.create({ intermediates: true, overwrite: false });
    file.write(
      normalizeMemoryDocument(
        [
          "# Memory",
          "",
          ...legacyMemories.map((memory) => `- ${memory.content}`),
        ].join("\n"),
      ),
    );

    const timestamp = nowIso();
    await db
      .update(memories)
      .set({ archivedAt: timestamp, enabled: false, updatedAt: timestamp })
      .where(isNull(memories.archivedAt));
  }

  async function ensureLegacyMigration() {
    migrationPromise ??= migrateLegacyMemories();
    await migrationPromise;
  }

  async function readMemory() {
    await ensureLegacyMigration();
    const file = getMemoryFile();

    if (!file.exists) {
      return null;
    }

    return toMemoryEntry(file, await file.text());
  }

  async function writeMemory(content: string) {
    ensureMemoryDirectory();
    const file = getMemoryFile();

    if (!file.exists) {
      file.create({ intermediates: true, overwrite: false });
    }

    file.write(normalizeMemoryDocument(content));
    return toMemoryEntry(file, await file.text());
  }

  return {
    async clear() {
      await ensureLegacyMigration();
      const file = getMemoryFile();

      if (file.exists) {
        file.delete();
      }
    },
    async read() {
      return readMemory();
    },
    async write(content) {
      return writeMemory(content);
    },
  };
}
