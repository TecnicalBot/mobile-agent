import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { app } from "electron";

/**
 * Main-process implementation of the small `expo-file-system` surface that
 * `src/core/db/migrations.ts` uses.
 *
 * ## Why this exists
 *
 * The migration history converts plugin, skill and agent blobs that older
 * versions stored in SQLite columns into real files on disk, and it reaches for
 * `expo-file-system` to do that. The desktop app has to run the same migrations
 * (that is the whole point of sharing one schema), so the main process needs the
 * module to resolve.
 *
 * It is wired up through an esbuild alias rather than by editing `migrations.ts`,
 * so `src/` stays free of desktop conditionals and the Android build is
 * untouched.
 *
 * ## Why it is not a shim over IPC
 *
 * This code *is* the main process, so it reads and writes the filesystem
 * directly. More importantly, the paths it produces must match the ones the
 * renderer's `expo-file-system` shim resolves, because migration 28 stores
 * `file.uri` in the database and the renderer's file services read it back.
 * Both sides therefore use `app.getPath("documents")` as `Paths.document`.
 *
 * ## Surface
 *
 * Only what the migrations call: `Paths.document`, `new Directory(...)`,
 * `new File(...)`, and the `exists` / `name` / `size` / `uri` properties plus
 * `create()`, `write()` and `delete()`.
 */

export type FileCreateOptions = {
  intermediates?: boolean;
  overwrite?: boolean;
  idempotent?: boolean;
};

export type DirectoryCreateOptions = {
  intermediates?: boolean;
  idempotent?: boolean;
  overwrite?: boolean;
};

/** `expo-file-system` URIs are `file://` URLs; the app stores them as such. */
function toFileUri(path: string): string {
  if (path.startsWith("file://")) {
    return path;
  }

  const normalised = path.replace(/\\/g, "/");

  return `file://${/^[A-Za-z]:\//.test(normalised) ? `/${normalised}` : normalised}`;
}

/** Accepts a `file://` URI or a plain path, so stored values round-trip. */
function toPath(value: string): string {
  if (!value.startsWith("file://")) {
    return value;
  }

  const withoutScheme = decodeURIComponent(value.slice("file://".length));
  const trimmed = withoutScheme.replace(/^\/+/, "");

  return /^[A-Za-z]:\//.test(trimmed) ? trimmed.replace(/\//g, "\\") : withoutScheme;
}

type PathLike = string | File | Directory;

function resolveSegments(segments: PathLike[]): string {
  const [head, ...rest] = segments;

  if (head === undefined) {
    throw new Error("A File or Directory requires at least one path segment.");
  }

  const base =
    head instanceof File || head instanceof Directory ? head.path : toPath(head);

  return rest.reduce<string>(
    (accumulated, segment) => join(accumulated, String(segment)),
    base,
  );
}

export class File {
  #path: string;

  constructor(...segments: PathLike[]) {
    this.#path = resolveSegments(segments);
  }

  get path(): string {
    return this.#path;
  }

  get uri(): string {
    return toFileUri(this.#path);
  }

  get name(): string {
    return basename(this.#path);
  }

  get exists(): boolean {
    return existsSync(this.#path);
  }

  get size(): number {
    try {
      return statSync(this.#path).size;
    } catch {
      return 0;
    }
  }

  create(options: FileCreateOptions = {}): void {
    if (options.intermediates) {
      mkdirSync(dirname(this.#path), { recursive: true });
    }

    if (this.exists) {
      if (options.overwrite) {
        writeFileSync(this.#path, "");

        return;
      }

      if (options.idempotent) {
        return;
      }

      throw new Error(`File already exists: ${this.#path}`);
    }

    writeFileSync(this.#path, "");
  }

  write(contents: string): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(this.#path, contents, "utf8");
  }

  textSync(): string {
    return readFileSync(this.#path, "utf8");
  }

  text(): string {
    return this.textSync();
  }

  delete(): void {
    rmSync(this.#path, { force: true });
  }
}

export class Directory {
  #path: string;

  constructor(...segments: PathLike[]) {
    this.#path = resolveSegments(segments);
  }

  get path(): string {
    return this.#path;
  }

  get uri(): string {
    return toFileUri(this.#path);
  }

  get name(): string {
    return basename(this.#path);
  }

  get exists(): boolean {
    return existsSync(this.#path);
  }

  create(options: DirectoryCreateOptions = {}): void {
    if (this.exists) {
      if (options.overwrite) {
        rmSync(this.#path, { force: true, recursive: true });
      } else {
        return;
      }
    }

    mkdirSync(this.#path, {
      recursive: options.intermediates ?? options.idempotent ?? false,
    });
  }

  delete(): void {
    rmSync(this.#path, { force: true, recursive: true });
  }
}

export class Paths {
  /**
   * Must stay identical to the renderer's `Paths.document`, which reads
   * `DesktopAppInfo.documentsPath`. The two together are what make a `file_path`
   * written by a migration readable by the app later.
   */
  static get document(): Directory {
    return new Directory(app.getPath("documents"));
  }

  static get cache(): Directory {
    return new Directory(app.getPath("temp"));
  }

  static get availableDiskSpace(): number {
    return 0;
  }

  static get totalDiskSpace(): number {
    return 0;
  }
}
