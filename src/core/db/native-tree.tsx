import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { useMemo, type ReactNode } from "react";

import { migrateAppDatabase } from "@/core/db/database";
import { createNativeRepositories } from "@/core/db/native";
import { AppStateProvider } from "@/providers/app-state";

/**
 * The Android/iOS database tree.
 *
 * `SQLiteProvider` owns the `expo-sqlite` handle and runs the migrations itself,
 * so the repositories can only be built once that context exists. Hence the
 * extra inner component: hooks cannot read a context provided further down.
 *
 * The `.web.tsx` sibling is what the Electron renderer gets. Splitting the two
 * by platform extension, rather than branching on `Platform.OS`, keeps
 * `expo-sqlite` and `drizzle-orm/expo-sqlite` out of the web module graph
 * entirely. That matters because the browser build of `expo-sqlite` imports a
 * `wa-sqlite.wasm` binary the published package does not ship, so merely
 * referencing the module fails `expo export`.
 */
function NativeDatabaseGate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const repositories = useMemo(() => createNativeRepositories(db), [db]);

  return (
    <AppStateProvider repositories={repositories}>{children}</AppStateProvider>
  );
}

export default function NativeDatabaseTree({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="mobile-agent.db" onInit={migrateAppDatabase}>
      <NativeDatabaseGate>{children}</NativeDatabaseGate>
    </SQLiteProvider>
  );
}
