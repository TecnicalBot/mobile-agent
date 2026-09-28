import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * A `node:fs` stand-in for `expo-file-system`, for tests that transitively pull
 * in `migrateAppDatabase`.
 *
 * Migrations 27 and 28 move plugin, skill and agent blobs out of SQLite columns
 * and onto disk, so they `await import("expo-file-system")`. The real module
 * resolves through `expo-modules-core` to `react-native`, whose Flow-typed
 * sources no non-Metro bundler can parse, so any test touching the migration
 * chain has to replace it.
 *
 * `vi.mock` factories are hoisted above imports, so this cannot live inside the
 * factory; each test calls {@link expoFileSystemMock} from a factory that is
 * already in scope, and removes {@link fileSystemMockRoot} afterwards.
 *
 * The Electron main process replaces the same module with a real implementation
 * via an esbuild alias (`desktop/src/main/shims/expo-file-system.ts`).
 */

/** Where {@link expoFileSystemMock} pretends the document directory lives. */
export const fileSystemMockRoot = join(
  tmpdir(),
  "mobile-agent-migration-fs",
);

/**
 * Returns a module object shaped like `expo-file-system`, rooted at
 * {@link fileSystemMockRoot}.
 *
 * `await` the result inside a `vi.mock` factory:
 *
 *     vi.mock("expo-file-system", async () => await expoFileSystemMock());
 */
export async function expoFileSystemMock() {
  const {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
  } = await import("node:fs");
  const { basename, dirname, join } = await import("node:path");

  type PathLike = string | { path: string };

  const toPath = (value: PathLike): string =>
    typeof value === "string" ? value : value.path;

  const resolveSegments = (segments: PathLike[]): string =>
    segments
      .map((segment) => toPath(segment))
      .join("\\")
      .replace(/\\+/g, "\\");

  class File {
    readonly path: string;

    constructor(...segments: PathLike[]) {
      this.path = resolveSegments(segments);
    }

    get uri(): string {
      return `file://${this.path.replace(/\\/g, "/")}`;
    }

    get name(): string {
      return basename(this.path);
    }

    get exists(): boolean {
      return existsSync(this.path);
    }

    get size(): number {
      return this.exists ? readFileSync(this.path, "utf8").length : 0;
    }

    create(options: { intermediates?: boolean } = {}): void {
      if (options.intermediates) {
        mkdirSync(dirname(this.path), { recursive: true });
      }

      if (!this.exists) {
        writeFileSync(this.path, "", "utf8");
      }
    }

    write(contents: string): void {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, contents, "utf8");
    }

    textSync(): string {
      return readFileSync(this.path, "utf8");
    }

    text(): string {
      return this.textSync();
    }

    delete(): void {
      rmSync(this.path, { force: true });
    }
  }

  class Directory {
    readonly path: string;

    constructor(...segments: PathLike[]) {
      this.path = resolveSegments(segments);
    }

    get uri(): string {
      return `file://${this.path.replace(/\\/g, "/")}`;
    }

    get name(): string {
      return basename(this.path);
    }

    get exists(): boolean {
      return existsSync(this.path);
    }

    create(): void {
      if (!this.exists) {
        mkdirSync(this.path, { recursive: true });
      }
    }

    delete(): void {
      rmSync(this.path, { force: true, recursive: true });
    }
  }

  class Paths {
    static get document(): Directory {
      return new Directory(fileSystemMockRoot);
    }

    static get cache(): Directory {
      return new Directory(join(fileSystemMockRoot, "cache"));
    }
  }

  return { File, Directory, Paths };
}
