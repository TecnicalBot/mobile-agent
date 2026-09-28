import { useMemo, type ReactNode } from "react";

import { createBridgeRepositories } from "@/core/db/bridge";
import { AppStateProvider } from "@/providers/app-state";

/**
 * The Electron database tree.
 *
 * There is no `expo-sqlite` on this host. The Drizzle handle is a
 * `drizzle-orm/sqlite-proxy` instance that forwards each `(sql, params)` pair to
 * the main process over IPC, where a `node:sqlite` connection answers it, and
 * the migrations already ran in the main process before the window opened.
 *
 * The Android/iOS implementation lives in `native-tree.tsx`.
 */
export default function BridgeDatabaseTree({
  children,
}: {
  children: ReactNode;
}) {
  // Built once per renderer lifetime. `createBridgeRepositories` is
  // synchronous: it wraps the preload bridge in a proxy driver and returns.
  const repositories = useMemo(() => createBridgeRepositories(), []);

  return (
    <AppStateProvider repositories={repositories}>{children}</AppStateProvider>
  );
}
