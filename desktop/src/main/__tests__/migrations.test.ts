import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATABASE_VERSION, migrateAppDatabase } from "@/core/db/migrations";

import { NodeSqliteAdapter } from "../database";
import { fileSystemMockRoot } from "./helpers/expo-file-system-mock";

/**
 * Runs the real migration chain against a throwaway `node:sqlite` database.
 *
 * This is the same code path the Electron main process uses — it hands
 * `migrateAppDatabase` the real `NodeSqliteAdapter`, not a stand-in — and it is
 * the only test that exercises the chain end to end. The Android build runs the
 * identical SQL against `expo-sqlite`.
 *
 * It exists because a fresh install is the case that goes wrong quietly: the
 * migrator runs several `ensure*Column` repair steps *before* the version gates,
 * so a step that assumes a table exists fails only when the database has no
 * history at all.
 *
 * It lives under `desktop/` rather than beside `src/core/db/migrations.ts`
 * because it is a Node-side test: it needs `node:sqlite` types, which the app's
 * `tsconfig` deliberately does not provide, and the Electron main process is the
 * host whose runtime it can use.
 *
 * See `helpers/expo-file-system-mock.ts` for why the `expo-file-system` import
 * inside the migration chain has to be replaced here.
 */

vi.mock(
  "expo-file-system",
  async () =>
    (await import("./helpers/expo-file-system-mock")).expoFileSystemMock(),
);

let directory: string;
let db: DatabaseSync;
let adapter: NodeSqliteAdapter;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mobile-agent-migration-"));
  db = new DatabaseSync(join(directory, "test.db"));

  adapter = new NodeSqliteAdapter(db);
});

afterEach(() => {
  adapter.close();
  rmSync(directory, { force: true, recursive: true });
  // Migrations 27 and 28 write through the mocked `Paths.document`.
  rmSync(fileSystemMockRoot, { force: true, recursive: true });
});

function version(): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
}

function tableNames(): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function columnsOf(table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("migrateAppDatabase", () => {
  it("creates the full schema on a fresh database", async () => {
    await migrateAppDatabase(adapter);

    const tables = tableNames();

    for (const table of [
      "agent_runs",
      "agents",
      "conversations",
      "mcp_servers",
      "messages",
      "model_presets",
      "plugin_storage",
      "plugins",
      "provider_accounts",
      "provider_configs",
      "schedule_runs",
      "schedules",
      "skills",
      "workspace_files",
    ]) {
      expect(tables, `expected table ${table}`).toContain(table);
    }
  });

  it("lands on the current schema version", async () => {
    await migrateAppDatabase(adapter);

    expect(version()).toBe(DATABASE_VERSION);
  });

  it("does not fail on the pre-gate column repairs when tables are absent", async () => {
    // `mcp_servers` is only created inside a version gate, so a fresh database
    // reaches the unconditional `ensureMcpServersOauthModeColumn` repair before
    // the table exists. The repair has to be a no-op in that case rather than
    // issuing an `ALTER TABLE` against a table that is not there.
    await expect(migrateAppDatabase(adapter)).resolves.toBeUndefined();

    expect(columnsOf("mcp_servers")).toContain("oauth_mode");
  });

  it("applies the columns that later migrations add", async () => {
    await migrateAppDatabase(adapter);

    // Added by the `currentVersion >= DATABASE_VERSION` repair branch.
    expect(columnsOf("conversations")).toEqual(
      expect.arrayContaining([
        "agent_id",
        "agent_mode",
        "pinned_at",
        "selected_mcp_server_ids_json",
      ]),
    );

    // Added by migration 27, which moves plugin source out of a column.
    expect(columnsOf("plugins")).toEqual(
      expect.arrayContaining(["file_path", "source_url", "last_update_check"]),
    );
    expect(columnsOf("plugins")).not.toContain("source");
  });

  it("is idempotent: re-running changes nothing", async () => {
    await migrateAppDatabase(adapter);
    const first = tableNames();

    await migrateAppDatabase(adapter);

    expect(tableNames()).toEqual(first);
    expect(version()).toBe(DATABASE_VERSION);
  });
});
