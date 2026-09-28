import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { migrateAppDatabase, DATABASE_VERSION } from "@/core/db/migrations";
import type { RawSqliteDatabase } from "@/core/db/raw";

/** The subset of `StatementSync` this module uses, kept narrow for clarity. */
type BindableStatement = Pick<
  StatementSync,
  "all" | "get" | "run" | "columns"
>;

export interface DesktopDatabase {
  /** Absolute path of the SQLite file on disk. */
  readonly file: string;
  /**
   * Runs one `(sql, params)` pair. Dispatched over IPC by the main process.
   *
   * Read rows are positional arrays; see {@link toPositionalRows}. A write
   * instead yields the affected-row count as a single scalar, which is what
   * `drizzle-orm/sqlite-proxy` expects back for its `run` method.
   */
  query(sql: string, params: unknown[]): { rows: unknown[] };
  close(): void;
}

/**
 * Normalises the two bind-parameter call styles used across the codebase into
 * the positional array that `node:sqlite` expects.
 *
 * `expo-sqlite` accepts either `(sql, [a, b])` or `(sql, a, b)`; Drizzle's
 * `sqlite-proxy` driver always uses a single positional array.
 *
 * The cast to `SQLInputValue` is the one place where the untyped IPC boundary is
 * asserted. The parameters arrive from the renderer, but Drizzle produced them
 * from this same schema, so they are already limited to the types SQLite can
 * bind: null, number, bigint, string and Uint8Array.
 */
function normaliseParams(params: readonly unknown[]): SQLInputValue[] {
  const values =
    params.length === 1 && Array.isArray(params[0])
      ? (params[0] as unknown[])
      : [...params];

  return values as SQLInputValue[];
}

function bind(statement: BindableStatement, params: SQLInputValue[]): {
  all: () => unknown[];
  get: () => unknown;
  run: () => unknown;
} {
  return {
    all: () => statement.all(...params),
    get: () => statement.get(...params),
    run: () => statement.run(...params),
  };
}

/**
 * Rewrites `node:sqlite`'s name-keyed rows into the positional arrays that
 * `drizzle-orm/sqlite-proxy` expects.
 *
 * This is not a stylistic choice. The proxy session maps results with
 * `mapResultRow`, which reads `row[columnIndex]` — the value at index 0, 1, 2 …
 * of the row, in the order the columns were selected. Hand it the object that
 * `StatementSync.all()` returns and every lookup is `row["0"]`, which is
 * `undefined`, so a query "succeeds" and hands the repositories a row of
 * `undefined`s. The failure then surfaces far away, as a `TypeError` on some
 * unrelated property.
 *
 * `statement.columns()` is used rather than `Object.keys(row)` because it keeps
 * the selected order and keeps duplicates, so `select "a"."id", "b"."id"` maps
 * correctly instead of collapsing both into one column.
 */
function toPositionalRows(
  statement: Pick<StatementSync, "columns">,
  rows: unknown[],
): unknown[][] {
  if (rows.length === 0) {
    return [];
  }

  if (typeof statement.columns !== "function") {
    throw new Error(
      "This Node build's `node:sqlite` statements have no `columns()`, which is " +
        "required to map query results positionally for Drizzle.",
    );
  }

  const names = statement
    .columns()
    .map((column) => column.name);

  return rows.map((row) => {
    const record = row as Record<string, unknown>;

    return names.map((name) => record[name]);
  });
}

/**
 * Adapts `node:sqlite` to the raw-SQLite surface that `migrateAppDatabase`
 * expects, so the main process runs the exact same 26 migration steps as
 * Android instead of carrying a second copy of the schema.
 *
 * Two different result shapes come out of here, because there are two different
 * consumers: {@link getAllAsync} and {@link getFirstAsync} hand back
 * name-keyed objects because the migration chain reads rows by column name
 * (`row.name`, `row.user_version`), while {@link query} hands back positional
 * arrays because that is the only shape `drizzle-orm/sqlite-proxy` can map.
 *
 * Exported so `desktop/src/main/__tests__/database.test.ts` can drive the real
 * implementation. A hand-written stand-in would let the test pass while the
 * adapter it is meant to cover regresses, which is the opposite of the point.
 */
export class NodeSqliteAdapter implements RawSqliteDatabase {
  readonly #db: DatabaseSync;
  readonly #cache = new Map<string, BindableStatement>();

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  #prepare(sql: string): BindableStatement {
    let statement = this.#cache.get(sql);

    if (!statement) {
      statement = this.#db.prepare(sql) as BindableStatement;
      this.#cache.set(sql, statement);
    }

    return statement;
  }

  async execAsync(query: string): Promise<void> {
    this.#db.exec(query);
  }

  async getAllAsync<T = unknown>(
    query: string,
    params?: unknown,
  ): Promise<T[]> {
    const values = normaliseParams(
      params === undefined ? [] : Array.isArray(params) ? params : [params],
    );

    return bind(this.#prepare(query), values).all() as T[];
  }

  async getFirstAsync<T = unknown>(
    query: string,
    params?: unknown,
  ): Promise<T | null> {
    const values = normaliseParams(
      params === undefined ? [] : Array.isArray(params) ? params : [params],
    );

    return (bind(this.#prepare(query), values).get() as T | undefined) ?? null;
  }

  async runAsync(query: string, ...params: unknown[]): Promise<unknown> {
    return bind(this.#prepare(query), normaliseParams(params)).run();
  }

  /**
   * Executes a single statement and returns its rows.
   *
   * Drizzle's `sqlite-proxy` driver asks for one of four methods and expects
   * `{ rows }` back in every case, including for writes (where it wants the
   * number of affected rows).
   *
   * Read results are positional arrays, not the name-keyed objects
   * `node:sqlite` produces; see {@link toPositionalRows} for why.
   */
  query(sql: string, params: unknown[]): { rows: unknown[] } {
    const statement = this.#prepare(sql);
    const values = normaliseParams(params);
    const trimmed = sql.trimStart();

    const isRead =
      /^select/i.test(trimmed) ||
      /^pragma/i.test(trimmed) ||
      /^with/i.test(trimmed) ||
      /^explain/i.test(trimmed);

    if (isRead) {
      return {
        rows: toPositionalRows(statement, statement.all(...values) as unknown[]),
      };
    }

    if (/^(insert|update|delete|replace)/i.test(trimmed)) {
      const result = statement.run(...values);

      // `sqlite-proxy` surfaces writes as a `rows: [changes]` array so that
      // Drizzle can report how many rows were affected.
      return { rows: [Number(result.changes)] };
    }

    this.#db.exec(sql);

    return { rows: [] };
  }

  close(): void {
    this.#cache.clear();
    this.#db.close();
  }
}

/**
 * Opens (and if necessary creates and migrates) the desktop database.
 *
 *
 * Migration strategy: run the real chain from version 0.
 *
 * Seeding `PRAGMA user_version = DATABASE_VERSION` to skip the history does not
 * work. `migrateAppDatabase` runs its `ensure*Column` repair steps *before* the
 * version check, and those `ALTER TABLE` statements assume the tables already
 * exist, so a pre-seeded empty file fails on `mcp_servers`.
 *
 * Starting from 0 is also the honest choice: a desktop install has no legacy
 * rows to convert, so the data-moving migrations find nothing to move, and the
 * schema they build is by construction the same one Android ends up with. The
 * `expo-file-system` calls in migrations 27 and 28 resolve to
 * `desktop/src/main/shims/expo-file-system.ts` via the esbuild alias, which
 * writes to the same `Documents/mobile-agent/...` layout the renderer expects.
 */
export async function openDesktopDatabase(
  directory: string,
): Promise<DesktopDatabase> {
  const file = join(directory, "mobile-agent.db");

  mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  const adapter = new NodeSqliteAdapter(db);

  // Set before migrating: the renderer's reads should not block on a write, and
  // the version-0 migration block sets this too, but only after its first
  // `CREATE TABLE`.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  await migrateAppDatabase(adapter);

  // Logged rather than asserted: a version mismatch is worth seeing in the
  // console, but refusing to start would leave the user with no UI to fix it
  // from, and `migrateAppDatabase` is the only thing that writes this value.
  const versionRow = await adapter.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );

  console.info(
    `[database] migrated to version ${versionRow?.user_version ?? "?"} (expected ${DATABASE_VERSION})`,
  );

  return {
    file,
    query: (sql, params) => adapter.query(sql, params),
    close: () => adapter.close(),
  };
}
