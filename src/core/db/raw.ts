/**
 * The minimal raw-SQLite surface that schema migration needs.
 *
 * `expo-sqlite`'s `SQLiteDatabase` structurally satisfies this interface, so
 * Android/iOS keep passing their own handle. The Electron main process
 * satisfies it with `node:sqlite`, which lets it run the *same* 26 migration
 * steps verbatim instead of maintaining a parallel copy of the schema.
 *
 * Every method is async to match `expo-sqlite`, even though `node:sqlite` is
 * synchronous underneath; the callers already await.
 */
export interface RawSqliteDatabase {
  /** Runs one or more statements, discarding any rows. */
  execAsync(query: string): Promise<void>;

  /**
   * Returns every row of a query.
   *
   * `params` is intentionally `unknown`: some call sites bind positionally
   * (`[a, b]`) and `expo-sqlite` also permits a named-parameter object, so the
   * widest possible type is what keeps the concrete handles assignable here.
   */
  getAllAsync<T = unknown>(query: string, params?: unknown): Promise<T[]>;

  /** Returns the first row of a query, or `null` when there are none. */
  getFirstAsync<T = unknown>(query: string, params?: unknown): Promise<T | null>;

  /**
   * Executes a single statement with bound parameters.
   *
   * Parameters may be passed either as a single array or as trailing varargs;
   * both call styles appear in the migration history.
   */
  runAsync(query: string, ...params: unknown[]): Promise<unknown>;
}
