import type {
  CreateDirectoryOptions,
  CreateFileOptions,
  DesktopFileStat,
  FileWriteOptions,
  RelocationOptions,
} from "../../shared/contract";
import { basename, dirname, fromFileUri, joinPath, toFileUri } from "../../shared/paths";
import { bridge as desktopBridge } from "./bridge";

/**
 * Renderer-side implementation of the `expo-file-system` API.
 *
 * Metro aliases the `expo-file-system` specifier to this module for web
 * builds, so the app's own filesystem code (`workspace-file-service`,
 * `file-memory-store`, the import/export drawers, ...) runs unchanged against
 * the Electron main process. Nothing in `src/` needed to know about desktop.
 *
 * The surface mirrors `expo-file-system`'s shape, including the fact that most
 * of it is synchronous: `exists`, `size`, `create()`, `write()`, `delete()` and
 * `Directory.list()` are plain reads and void methods. Those go through
 * `window.desktop.fsSync`, which is `ipcRenderer.sendSync` under the hood.
 *
 * A missing bridge (for example when this bundle is opened in a plain browser)
 * is not fatal at import time: `Paths.document` and `Paths.cache` fall back to
 * placeholder roots and only the first real filesystem call throws.
 */

const PLACEHOLDER_ROOTS = {
  documentsPath: "/documents",
  tempPath: "/cache",
} as const;

function bridge() {
  return desktopBridge("The filesystem");
}
function fsSync() {
  return bridge().fsSync;
}

/**
 * Reads one of the well-known roots off the bridge, falling back to a
 * placeholder so that `Paths.document` can be constructed at module scope
 * without the bridge being present.
 */
function rootPath(key: keyof typeof PLACEHOLDER_ROOTS): string {
  try {
    return bridge().app[key];
  } catch {
    return PLACEHOLDER_ROOTS[key];
  }
}

/** Resolves a constructor argument list down to a single absolute path. */
function resolveSegments(segments: (string | File | Directory)[]): string {
  if (segments.length === 0) {
    throw new Error("A File or Directory requires at least one path segment.");
  }

  const [head, ...rest] = segments;
  const base =
    head instanceof File || head instanceof Directory
      ? head.path
      : fromFileUri(head);

  return joinPath(base, ...rest.map((segment) => (segment as string).toString()));
}

function resolveDestination(
  destination: File | Directory,
  options: RelocationOptions | undefined,
): string {
  return joinPath(destination.path);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }

  return btoa(binary);
}

export type FileCreateOptions = CreateFileOptions;
export type DirectoryCreateOptions = CreateDirectoryOptions;
export type { RelocationOptions, FileWriteOptions };

export type FileInfo = {
  exists: boolean;
  uri?: string;
  size?: number;
  modificationTime?: number;
  creationTime?: number;
};

export type DirectoryInfo = {
  exists: boolean;
  uri?: string;
  size?: number;
  modificationTime?: number;
  creationTime?: number;
  files?: string[];
};

export type PathInfo = { exists: boolean; isDirectory: boolean | null };

/** Represents a file on the filesystem. */
export class File {
  #path: string;

  constructor(...segments: (string | File | Directory)[]) {
    this.#path = resolveSegments(segments);
  }

  get path(): string {
    return this.#path;
  }

  /** The file URI. */
  get uri(): string {
    return toFileUri(this.#path);
  }

  get parentDirectory(): Directory {
    return new Directory(dirname(this.#path));
  }

  get name(): string {
    return basename(this.#path);
  }

  get extension(): string {
    const name = this.name;
    const index = name.lastIndexOf(".");

    return index <= 0 ? "" : name.slice(index);
  }

  get exists(): boolean {
    return fsSync().stat(this.#path).exists;
  }

  get size(): number {
    return fsSync().stat(this.#path).size;
  }

  get type(): string {
    return fsSync().stat(this.#path).mimeType;
  }

  get lastModified(): Date | null {
    const value = fsSync().stat(this.#path).lastModified;

    return value === null ? null : new Date(value);
  }

  get creationTime(): Date | null {
    const value = fsSync().stat(this.#path).creationTime;

    return value === null ? null : new Date(value);
  }

  /** Android-only; on desktop this is the plain `file://` URI. */
  get contentUri(): string {
    return fsSync().contentUri(this.#path);
  }

  /** Not implemented on desktop; MD5 would require a native hash module. */
  get md5(): string | null {
    return null;
  }

  create(options: FileCreateOptions = {}): void {
    fsSync().createFile(this.#path, {
      intermediates: options.intermediates,
      overwrite: options.overwrite,
    });
  }

  write(content: string | Uint8Array, options: FileWriteOptions = {}): void {
    if (typeof content === "string") {
      fsSync().writeFile(this.#path, content, options);

      return;
    }

    fsSync().writeFile(this.#path, toBase64(content), {
      ...options,
      encoding: "base64",
    });
  }

  textSync(): string {
    return fsSync().readTextFile(this.#path);
  }

  async text(): Promise<string> {
    return fsSync().readTextFile(this.#path);
  }

  bytesSync(): Uint8Array {
    return fsSync().readBytesFile(this.#path);
  }

  async bytes(): Promise<Uint8Array> {
    return fsSync().readBytesFile(this.#path);
  }

  base64Sync(): string {
    return toBase64(this.bytesSync());
  }

  async base64(): Promise<string> {
    return toBase64(await this.bytes());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();

    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text()) as unknown;
  }

  info(): FileInfo {
    const stat = fsSync().stat(this.#path);

    return {
      exists: stat.exists,
      uri: toFileUri(stat.path),
      size: stat.size,
      modificationTime: stat.lastModified ?? undefined,
      creationTime: stat.creationTime ?? undefined,
    };
  }

  delete(): void {
    fsSync().deleteEntry(this.#path);
  }

  copySync(destination: File | Directory, options?: RelocationOptions): void {
    fsSync().copyEntry(this.#path, resolveDestination(destination, options), options);
  }

  async copy(destination: File | Directory, options?: RelocationOptions) {
    this.copySync(destination, options);
  }

  moveSync(destination: File | Directory, options?: RelocationOptions): void {
    fsSync().moveEntry(
      this.#path,
      resolveDestination(destination, options),
      options,
    );
    this.#path = destination.path;
  }

  async move(destination: File | Directory, options?: RelocationOptions) {
    this.moveSync(destination, options);
  }

  rename(newName: string): void {
    this.#path = fsSync().rename(this.#path, newName);
  }

  /**
   * Mirrors `File.downloadFileAsync`.
   *
   * When the destination is a directory the file name is taken from the URL,
   * which is what `expo-file-system` does on Android.
   */
  static async downloadFileAsync(
    url: string,
    destination: File | Directory,
    options?: { idempotent?: boolean },
  ): Promise<File> {
    const target =
      destination instanceof Directory
        ? new File(destination, filenameFromUrl(url))
        : destination;

    await bridge().fs.downloadFile(
      url,
      target.path,
      options ? { idempotent: options.idempotent } : undefined,
    );

    return target;
  }

  static async pickFileAsync(): Promise<never> {
    throw new Error(
      "File picking is not available on desktop. Use the folder picker instead.",
    );
  }
}

function filenameFromUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  const segments = withoutQuery.split("/").filter(Boolean);

  return segments[segments.length - 1] ?? "download";
}

/** Represents a directory on the filesystem. */
export class Directory {
  #path: string;

  constructor(...segments: (string | File | Directory)[]) {
    this.#path = resolveSegments(segments);
  }

  get path(): string {
    return this.#path;
  }

  get uri(): string {
    return toFileUri(this.#path);
  }

  get parentDirectory(): Directory {
    return new Directory(dirname(this.#path));
  }

  get name(): string {
    return basename(this.#path);
  }

  get exists(): boolean {
    return fsSync().stat(this.#path).exists;
  }

  get size(): number | null {
    const stat = fsSync().stat(this.#path);

    return stat.exists && stat.type === "directory" ? 0 : stat.size;
  }

  create(options: DirectoryCreateOptions = {}): void {
    fsSync().createDirectory(this.#path, {
      intermediates: options.intermediates,
      idempotent: options.idempotent,
      overwrite: options.overwrite,
    });
  }

  delete(): void {
    fsSync().deleteEntry(this.#path);
  }

  /** Lists the directory contents. Throws if the directory is missing. */
  list(): (Directory | File)[] {
    if (!this.exists) {
      throw new Error(`Directory does not exist: ${this.#path}`);
    }

    return fsSync()
      .list(this.#path)
      .map((entry) =>
        entry.type === "directory"
          ? new Directory(entry.path)
          : new File(entry.path),
      );
  }

  createFile(name: string): File {
    return new File(this.#path, name);
  }

  createDirectory(name: string): Directory {
    return new Directory(this.#path, name);
  }

  copySync(destination: File | Directory, options?: RelocationOptions): void {
    fsSync().copyEntry(this.#path, destination.path, options);
  }

  async copy(destination: File | Directory, options?: RelocationOptions) {
    this.copySync(destination, options);
  }

  moveSync(destination: File | Directory, options?: RelocationOptions): void {
    fsSync().moveEntry(this.#path, destination.path, options);
    this.#path = destination.path;
  }

  async move(destination: File | Directory, options?: RelocationOptions) {
    this.moveSync(destination, options);
  }

  rename(newName: string): void {
    this.#path = fsSync().rename(this.#path, newName);
  }

  info(): DirectoryInfo {
    const stat = fsSync().stat(this.#path);

    return {
      exists: stat.exists,
      uri: toFileUri(stat.path),
      size: stat.size,
      modificationTime: stat.lastModified ?? undefined,
      creationTime: stat.creationTime ?? undefined,
      files: stat.exists
        ? fsSync()
            .list(stat.path)
            .map((entry) => entry.path)
        : undefined,
    };
  }

  /**
   * Mirrors `Directory.pickDirectoryAsync`.
   *
   * Android returns a SAF `content://` tree; on desktop this opens a native
   * folder dialog and returns a `file://` URI for the chosen directory.
   */
  static async pickDirectoryAsync(): Promise<Directory> {
    const chosen = await bridge().fs.pickDirectory();

    if (!chosen) {
      throw new Error("No directory was selected.");
    }

    return new Directory(chosen);
  }
}

/** Well-known filesystem locations, mirroring `expo-file-system`'s `Paths`. */
export class Paths {
  static get document(): Directory {
    return new Directory(rootPath("documentsPath"));
  }

  static get cache(): Directory {
    return new Directory(rootPath("tempPath"));
  }

  /** The read-only directory holding bundled assets. */
  static get bundle(): Directory {
    return new Directory(rootPath("documentsPath"), "bundle");
  }

  static get availableDiskSpace(): number {
    return fsSync().availableDiskSpace();
  }

  static get totalDiskSpace(): number {
    return Paths.availableDiskSpace;
  }

  static info(...uris: string[]): PathInfo {
    return uris.map((uri) => {
      const stat = fsSync().stat(fromFileUri(uri));

      return {
        exists: stat.exists,
        isDirectory: stat.exists ? stat.type === "directory" : null,
      };
    })[0] ?? { exists: false, isDirectory: null };
  }

  static join(...segments: string[]): string {
    const [head, ...rest] = segments;

    if (head === undefined) {
      throw new Error("Paths.join requires at least one segment.");
    }

    return joinPath(head, ...rest);
  }
}

/**
 * Convenience alias matching `expo-file-system`'s default export shape: a
 * runtime enum of encodings plus a type of the same name, derived from the
 * value so the two cannot drift.
 */
/* eslint-disable @typescript-eslint/no-redeclare */
export const EncodingType = {
  UTF8: "utf8",
  Base64: "base64",
} as const;

export type EncodingType = (typeof EncodingType)[keyof typeof EncodingType];
/* eslint-enable @typescript-eslint/no-redeclare */

export type { DesktopFileStat };
