import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateAppDatabase } from "@/core/db/migrations";
import { createProxyDb } from "@/core/db/proxy";
import { createRepositories } from "@/core/db/repositories";
import { providerConfigs } from "@/core/db/schema";
import { randomId } from "@/core/ids";
import { createFileMemoryStore } from "@/modules/memory/file-memory-store";
import { asc, eq } from "drizzle-orm";

import { NodeSqliteAdapter } from "../database";
import { fileSystemMockRoot } from "./helpers/expo-file-system-mock";

/**
 * Drives Drizzle over the *real* desktop database adapter.
 *
 * The repositories in `src/core/db/repositories` are shared by the Android and
 * desktop builds, so the only thing that can differ between them is how a
 * `(sql, params)` pair is executed and how the returned rows are shaped. That
 * is precisely the seam covered here.
 *
 * It is easy to get wrong silently. `drizzle-orm/sqlite-proxy` maps each row
 * with `row[columnIndex]`, so a row whose shape is not positional does not fail
 * at the query: it produces objects full of `undefined` that blow up somewhere
 * unrelated, in application code, much later. The assertions below therefore
 * check field *values*, not just that a query ran.
 *
 * The adapter is imported rather than reimplemented, so a regression in
 * `NodeSqliteAdapter.query` fails this test instead of being papered over by a
 * test-only copy of the same logic. `structuredClone` stands in for the IPC hop
 * because that hop is part of what can corrupt a result.
 *
 * The migrations run first so the tables exist; see
 * `helpers/expo-file-system-mock.ts` for why that needs a stand-in module.
 *
 * The mock is registered through a dynamic import because `createRepositories`
 * reaches `expo-file-system` at module scope, so the factory would otherwise run
 * before this file's own imports are initialised.
 */

vi.mock(
  "expo-file-system",
  async () =>
    (await import("./helpers/expo-file-system-mock")).expoFileSystemMock(),
);

let directory: string;
let db: DatabaseSync;
let adapter: NodeSqliteAdapter;

/** The renderer's view of one statement, round-tripped across the IPC boundary. */
async function overIpc(sql: string, params: unknown[]) {
  return structuredClone(adapter.query(sql, params));
}

/** A Drizzle handle wired to the real adapter, as `src/core/db/bridge.ts` does. */
function handle() {
  return createProxyDb(overIpc);
}

/**
 * `ensureDefaultProviders` is called by the app, not by the migrations, so a
 * freshly migrated database has an empty `provider_configs` table. Without
 * seeding it, every mapping assertion below would pass vacuously.
 */
async function seeded() {
  const db = handle();

  await createRepositories(db, createFileMemoryStore(db)).configRepository.ensureDefaultProviders();

  return db;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "mobile-agent-proxy-"));
  db = new DatabaseSync(join(directory, "test.db"));

  db.exec("PRAGMA foreign_keys = ON;");

  adapter = new NodeSqliteAdapter(db);

  await migrateAppDatabase(adapter);
});

afterEach(() => {
  adapter.close();
  rmSync(directory, { force: true, recursive: true });
  rmSync(fileSystemMockRoot, { force: true, recursive: true });
});

describe("drizzle over the desktop database adapter", () => {
  it("maps selected columns onto typed field values", async () => {
    const db = await seeded();
    const rows = await db.select().from(providerConfigs);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // Every declared field has to resolve to a real value. A row-shape
      // mismatch shows up as `undefined` here, not as a thrown error.
      expect(typeof row.id, `id in ${JSON.stringify(row)}`).toBe("string");
      expect(typeof row.family).toBe("string");
      expect(typeof row.authType).toBe("string");
      expect(typeof row.createdAt).toBe("string");
      // `enabled` is stored as an integer and decoded by Drizzle, so a boolean
      // rather than 0/1 also proves `mapFromDriverValue` saw the right column.
      expect(typeof row.enabled).toBe("boolean");
    }
  });

  it("maps snake_case columns onto camelCase properties", async () => {
    const db = await seeded();
    const rows = await db.select().from(providerConfigs);

    // `auth_type` -> `authType`, `base_url` -> `baseUrl`, and so on. If the row
    // were keyed by the raw column name these would all be `undefined`.
    expect(rows.some((row) => row.authType === "apiKey")).toBe(true);
    expect(rows.some((row) => typeof row.baseUrl === "string")).toBe(true);
    expect(rows.some((row) => "authType" in row)).toBe(true);
  });

  it("distinguishes a null column from a missing one", async () => {
    const db = await seeded();
    const rows = await db.select().from(providerConfigs);

    // `oauth_account_email` is null for every API-key provider. `null` and
    // `undefined` are easy to confuse and only one of them is a real value.
    const emails = rows.map((row) => row.oauthAccountEmail);

    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((email) => email === null || typeof email === "string")).toBe(
      true,
    );
    expect(emails.some((email) => email === null)).toBe(true);
  });

  it("round-trips an insert and reads it back", async () => {
    const db = handle();
    const id = randomId();

    await db.insert(providerConfigs).values({
      id,
      family: "openai",
      label: "Test Provider",
      authType: "apiKey",
      baseUrl: "https://example.invalid",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const found = await db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.id, id));

    expect(found).toHaveLength(1);
    expect(found[0]?.label).toBe("Test Provider");
    expect(found[0]?.authType).toBe("apiKey");
    expect(found[0]?.enabled).toBe(true);
  });

  it("reports the affected row count for a write", async () => {
    const db = await seeded();

    const result = await db
      .update(providerConfigs)
      .set({ label: "Renamed" })
      .where(eq(providerConfigs.family, "openai"));

    // `sqlite-proxy` returns the driver's own result through unchanged and types
    // it as `unknown`, so the shape is `{ rows: [changes] }` rather than
    // `expo-sqlite`'s `{ changes, lastInsertRowid }`. No repository reads it, but
    // pinning it makes a change to the write branch a deliberate decision.
    const rows = (result as { rows: unknown[] }).rows;

    expect(Array.isArray(rows)).toBe(true);
    expect(Number(rows[0])).toBeGreaterThan(0);

    const renamed = await db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.label, "Renamed"));

    expect(renamed.length).toBeGreaterThan(0);
  });

  it("filters with a bound parameter", async () => {
    const db = await seeded();

    const all = await db.select().from(providerConfigs);
    const target = all[0];

    expect(target).toBeDefined();

    const filtered = await db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.id, target!.id));

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(target!.id);
  });

  it("orders by a column and deletes by a bound parameter", async () => {
    const db = await seeded();

    const ordered = await db
      .select()
      .from(providerConfigs)
      .orderBy(asc(providerConfigs.label));

    const labels = ordered.map((row) => row.label ?? "");

    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);

    await db.delete(providerConfigs).where(eq(providerConfigs.id, ordered[0]!.id));

    const remaining = await db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.id, ordered[0]!.id));

    expect(remaining).toHaveLength(0);
  });

  it("keeps a multi-statement transaction serialised over the bridge", async () => {
    const db = await seeded();
    const repositories = createRepositories(db, createFileMemoryStore(db));

    const before = await db.select().from(providerConfigs);
    const doomed = before[0]!;

    // `deleteProvider` runs a `db.transaction` that deletes presets and then the
    // provider config. Going through the repository rather than issuing the two
    // statements by hand is the point: the wrapper is what has to survive the
    // round trip, and a statement interleaving between BEGIN and COMMIT would be
    // invisible to a test that only ever issues one statement at a time.
    await repositories.configRepository.deleteProvider(doomed.id);

    const after = await db.select().from(providerConfigs);

    expect(after).toHaveLength(before.length - 1);
    expect(after.some((row) => row.id === doomed.id)).toBe(false);
  });
});
