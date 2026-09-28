/**
 * The contract between the Electron main process and the renderer.
 *
 * Both sides import these types: the preload script implements the client half,
 * the main process implements the server half, and the renderer-side shims for
 * `expo-file-system` / `expo-secure-store` are written against them.
 *
 * This file must stay free of both `electron` and Node built-ins so it can be
 * imported from any of the three contexts.
 */

/** Metadata for a single filesystem entry. */
export interface DesktopFileStat {
  /** Absolute path on disk. */
  path: string;
  exists: boolean;
  type: "file" | "directory";
  /** Size in bytes; `0` for directories and missing entries. */
  size: number;
  /** Epoch milliseconds, or `null` when unknown. */
  creationTime: number | null;
  lastModified: number | null;
  /** Guessed from the file extension; `""` for directories. */
  mimeType: string;
}

export interface CreateFileOptions {
  /** Create missing parent directories. */
  intermediates?: boolean;
  /** Overwrite an existing file. */
  overwrite?: boolean;
}

export interface CreateDirectoryOptions {
  /** Create missing parent directories. */
  intermediates?: boolean;
  /** Succeed silently when the directory already exists. */
  idempotent?: boolean;
  overwrite?: boolean;
}

export interface RelocationOptions {
  overwrite?: boolean;
}

export interface FileWriteOptions {
  /** Append instead of truncating. */
  append?: boolean;
  encoding?: "utf8" | "base64";
}

/**
 * Result of a single `(sql, params)` pair.
 *
 * For a read, `rows` is **positional**: each row is an array of column values in
 * the order the statement selected them, not an object keyed by column name.
 * That is the only shape `drizzle-orm/sqlite-proxy` can map — it reads
 * `row[columnIndex]` — and the renderer's SQL is produced by Drizzle, so nothing
 * downstream would prefer names.
 *
 * For a write, `rows` is a single-element array holding the number of affected
 * rows, which is what the driver asks for from its `run` method.
 */
export interface DesktopQueryResult {
  rows: unknown[];
}

export interface DesktopAppInfo {
  platform: string;
  version: string;
  electronVersion: string;
  databasePath: string;
  documentsPath: string;
  /**
   * Backing directory for `Paths.cache`.
   *
   * Electron has no dedicated cache directory, so this is the OS temp
   * directory. It is also on the filesystem allow-list.
   */
  tempPath: string;
}

/**
 * Synchronous filesystem operations.
 *
 * These exist because `expo-file-system` exposes most of its API
 * synchronously: `file.exists`, `file.size`, `file.create()`, `file.write()`
 * and `directory.list()` are all plain property reads and void methods that the
 * app calls without awaiting. `ipcRenderer.sendSync` is the only way to bridge
 * them. The main process handles each call locally against the filesystem, so
 * the round trip is sub-millisecond.
 */
export interface DesktopFsSync {
  stat(path: string): DesktopFileStat;
  list(path: string): DesktopFileStat[];
  createFile(path: string, options?: CreateFileOptions): void;
  createDirectory(path: string, options?: CreateDirectoryOptions): void;
  writeFile(path: string, contents: string, options?: FileWriteOptions): void;
  readTextFile(path: string): string;
  readBytesFile(path: string): Uint8Array;
  deleteEntry(path: string): void;
  copyEntry(from: string, to: string, options?: RelocationOptions): void;
  moveEntry(from: string, to: string, options?: RelocationOptions): void;
  /** Renames in place and returns the resulting absolute path. */
  rename(path: string, newName: string): string;
  contentUri(path: string): string;
  availableDiskSpace(): number;
}

/** Asynchronous filesystem operations. */
export interface DesktopFsAsync {
  stat(path: string): Promise<DesktopFileStat>;
  downloadFile(
    url: string,
    destination: string,
    options?: { idempotent?: boolean },
  ): Promise<DesktopFileStat>;
  /** Returns `null` when the user cancels. */
  pickDirectory(): Promise<string | null>;
}

/**
 * The API exposed on `window.desktop` by the preload script.
 */
export interface DesktopBridge {
  readonly app: DesktopAppInfo;
  readonly fsSync: DesktopFsSync;
  readonly fs: DesktopFsAsync;

  readonly secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };

  readonly db: {
    /**
     * Runs one statement. Always resolves to positional rows, including for
     * writes, where the single value is the number of affected rows.
     */
    query(sql: string, params: unknown[]): Promise<DesktopQueryResult>;
  };

  /**
   * Hands a target to the operating system.
   *
   * The app reaches for this wherever Android would fire an intent: opening a
   * release page, opening a workspace file, following a link. The main process
   * restricts it to a fixed set of schemes and, for `file:`, to the same
   * allow-list the filesystem bridge uses.
   */
  readonly shell: {
    openExternal(target: string): Promise<void>;
  };
}
