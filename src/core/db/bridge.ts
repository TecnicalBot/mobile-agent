import { createRepositories } from "@/core/db/repositories";
import { createProxyDb } from "@/core/db/proxy";
import type { Repositories } from "@/core/db/repositories/types";
import { createFileMemoryStore } from "@/modules/memory/file-memory-store";

/**
 * The subset of the desktop bridge that the renderer needs, injected by the
 * preload script.
 *
 * Declared structurally rather than imported from `desktop/` so that `src/`
 * stays independent of the Electron package and this module remains usable from
 * a plain web build.
 */
export interface DatabaseBridge {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: unknown[] }>;
}

interface BridgeWindow {
  desktop?: {
    db: DatabaseBridge;
  };
}

function getDatabaseBridge(): DatabaseBridge {
  const bridge = (globalThis as BridgeWindow).desktop?.db;

  if (!bridge) {
    throw new Error(
      "No desktop database bridge is available. On the web, run the app through `pnpm desktop:start` rather than a browser.",
    );
  }

  return bridge;
}

/**
 * Builds the repository set for the Electron renderer.
 *
 * The Drizzle handle is a `drizzle-orm/sqlite-proxy` instance whose executor
 * forwards `(sql, params)` to the main process over IPC, so the renderer's SQL
 * is the exact same SQL Android sends. `drizzle-orm` is fully driver-agnostic
 * here, which is why the repositories themselves needed no changes.
 *
 * The memory store is still `createFileMemoryStore`, because on the web
 * `expo-file-system` is aliased by Metro to a shim that forwards the same
 * operations to the main process. The store's own code is unchanged.
 */
export function createBridgeRepositories(): Repositories {
  const bridge = getDatabaseBridge();
  const db = createProxyDb((sql, params) => bridge.query(sql, params));

  return createRepositories(db, createFileMemoryStore(db));
}
