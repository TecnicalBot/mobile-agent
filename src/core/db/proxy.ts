import {
  drizzle as drizzleSqliteProxy,
  type AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy";

import { schema } from "@/core/db/schema";
import type { AppDatabase } from "@/core/db/repositories/types";

/**
 * Builds a Drizzle handle for a host that has no `expo-sqlite` runtime.
 *
 * `drizzle-orm/sqlite-proxy` is pure JavaScript: it only needs a callback that
 * can execute `(sql, params)` and return `{ rows }`. Who actually runs the SQL
 * is entirely up to the caller:
 *
 *   - Electron renderer -> `ipcRenderer.invoke("db:query", ...)`
 *   - Electron main     -> `better-sqlite3`, called directly
 *
 * Because the repositories only ever `await` their queries, both hosts execute
 * the identical repository code. This module deliberately contains no Electron
 * or Node imports so the same factory works in either process.
 *
 * The cast is required because Drizzle declares the `expo-sqlite` driver with
 * result kind `"sync"` and the proxy driver with `"async"`. Every repository
 * call site awaits its result, so both are satisfied at runtime; only the
 * declared mode differs. Confining the cast here means no repository needs to
 * know which host it is running on.
 */
export function createProxyDb(callback: AsyncRemoteCallback): AppDatabase {
  return drizzleSqliteProxy(callback, { schema }) as unknown as AppDatabase;
}
