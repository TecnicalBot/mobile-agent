/**
 * Renderer-side stub for `expo-sqlite`.
 *
 * The browser build of `expo-sqlite` imports a `wa-sqlite.wasm` binary that the
 * published package does not ship, so simply having the module in the graph
 * breaks `expo export --platform web` at bundle time.
 *
 * Nothing here is ever called on the desktop host. The renderer reaches SQLite
 * through the Electron main process instead, via the `drizzle-orm/sqlite-proxy`
 * handle built in `src/core/db/bridge.ts`, and the migrations run in the main
 * process before the window opens. The two entry points that do import this
 * module are the Android/iOS `SQLiteProvider` branch in `src/app/_layout.tsx`
 * and the headless scheduler task registration, and neither runs on web.
 *
 * Every export therefore throws with a message that says what actually happened,
 * so a future mistake surfaces as a clear error rather than a silent
 * `undefined is not a function`.
 */

function unavailable(name: string): never {
  throw new Error(
    `expo-sqlite.${name}() is not available on the desktop host. ` +
      "The renderer uses the IPC-backed database bridge instead; see src/core/db/bridge.ts.",
  );
}

export function openDatabaseSync(): never {
  return unavailable("openDatabaseSync");
}

export function openDatabaseAsync(): never {
  return unavailable("openDatabaseAsync");
}

export function deleteDatabaseSync(): never {
  return unavailable("deleteDatabaseSync");
}

export function deleteDatabaseAsync(): never {
  return unavailable("deleteDatabaseAsync");
}

export function SQLiteProvider(): never {
  return unavailable("SQLiteProvider");
}

export function useSQLiteContext(): never {
  return unavailable("useSQLiteContext");
}

export function useSQLiteConnection(): never {
  return unavailable("useSQLiteConnection");
}

export function useTransaction(): never {
  return unavailable("useTransaction");
}

/**
 * The `expo-sqlite` database type, kept structurally compatible with the real
 * one so that `src/core/db/repositories/types.ts` still typechecks. Only the
 * shape matters; no value of this type is ever constructed on web.
 */
export interface SQLiteDatabase {
  readonly __brand?: never;
}
