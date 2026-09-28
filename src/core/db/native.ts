import { drizzle as drizzleExpoSqlite } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import { createRepositories } from "@/core/db/repositories";
import { schema } from "@/core/db/schema";
import type { Repositories } from "@/core/db/repositories/types";
import { createFileMemoryStore } from "@/modules/memory/file-memory-store";

/**
 * Native (Android/iOS) database wiring.
 *
 * This is the only module that binds the repository layer to Expo native
 * drivers. It is intentionally excluded from the portability lint boundary in
 * `eslint.config.js`, because `expo-sqlite` and `expo-file-system` do not exist
 * outside an Expo runtime.
 *
 * Electron hosts use `desktop/src/main` instead, which binds the same
 * repositories to a `drizzle-orm/sqlite-proxy` handle.
 */
export function createNativeRepositories(sqliteDb: SQLiteDatabase): Repositories {
  const db = drizzleExpoSqlite(sqliteDb, { schema });

  return createRepositories(db, createFileMemoryStore(db));
}
