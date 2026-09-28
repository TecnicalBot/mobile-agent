import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type {
  CreateDirectoryOptions,
  DesktopFileStat,
  DesktopFsAsync,
  DesktopFsSync,
  FileWriteOptions,
  RelocationOptions,
} from "../shared/contract";
import { fromFileUri, isInsideRoot, toFileUri } from "../shared/paths";

/**
 * Filesystem access for the renderer, executed in the main process.
 *
 * Every path is resolved through {@link resolvePath}, which rejects anything
 * outside {@link allowedRoots}. The renderer runs with `contextIsolation`, no
 * Node integration and `sandbox: true`, so this allow-list is the boundary that
 * stops a compromised page from reading or writing arbitrary files.
 */

/** Directories the renderer may touch without asking the user. */
const allowedRoots = new Set<string>();

export function allowRoot(path: string): void {
  allowedRoots.add(path.replace(/[\\/]+$/, ""));
}

/** Grants access to a directory the user explicitly picked in a dialog. */
export function allowPickedRoot(path: string): void {
  allowRoot(path);
}

function resolvePath(input: string): string {
  const path = fromFileUri(input);

  for (const root of allowedRoots) {
    if (isInsideRoot(root, path)) {
      return path;
    }
  }

  throw new Error(
    `Filesystem access denied for "${path}": it is outside the directories this app may use.`,
  );
}

/**
 * Whether `input` is inside an allowed root.
 *
 * Used by the `shell:openExternal` handler, which must apply the same boundary
 * to `file:` targets as the filesystem bridge does. Reuses the same allow-list
 * rather than keeping a second copy in sync.
 */
export function isAllowedPath(input: string): boolean {
  try {
    resolvePath(input);

    return true;
  } catch {
    return false;
  }
}

const MIME_TYPES: Record<string, string> = {
  bmp: "image/bmp",
  css: "text/css",
  csv: "text/csv",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsonl: "application/jsonl",
  md: "text/markdown",
  mjs: "text/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  yaml: "text/yaml",
  yml: "text/yaml",
  zip: "application/zip",
};

function guessMimeType(path: string): string {
  const extension = path.includes(".")
    ? path.slice(path.lastIndexOf(".") + 1).toLowerCase()
    : "";

  return MIME_TYPES[extension] ?? "";
}

const MISSING: Omit<DesktopFileStat, "path" | "mimeType"> = {
  exists: false,
  type: "file",
  size: 0,
  creationTime: null,
  lastModified: null,
};

function describeSync(path: string): DesktopFileStat {
  try {
    const info = statSync(path);
    const isDirectory = info.isDirectory();

    return {
      path,
      exists: true,
      type: isDirectory ? "directory" : "file",
      size: isDirectory ? 0 : info.size,
      creationTime: Number.isNaN(info.birthtimeMs) ? null : info.birthtimeMs,
      lastModified: info.mtimeMs,
      mimeType: isDirectory ? "" : guessMimeType(path),
    };
  } catch {
    return { ...MISSING, path, mimeType: guessMimeType(path) };
  }
}

async function describe(path: string): Promise<DesktopFileStat> {
  try {
    const info = await stat(path);
    const isDirectory = info.isDirectory();

    return {
      path,
      exists: true,
      type: isDirectory ? "directory" : "file",
      size: isDirectory ? 0 : info.size,
      creationTime: Number.isNaN(info.birthtimeMs) ? null : info.birthtimeMs,
      lastModified: info.mtimeMs,
      mimeType: isDirectory ? "" : guessMimeType(path),
    };
  } catch {
    return { ...MISSING, path, mimeType: guessMimeType(path) };
  }
}

/**
 * Synchronous half, reached through `ipcRenderer.sendSync`.
 *
 * `expo-file-system` reads `exists` / `size` / `lastModified` as plain
 * properties and calls `create()` / `write()` / `delete()` without awaiting, so
 * these cannot be promises.
 */
export const filesystemSync: DesktopFsSync = {
  stat: (input) => describeSync(resolvePath(input)),

  list: (input) => {
    const path = resolvePath(input);

    return readdirSync(path).map((name) =>
      describeSync(join(path, name)),
    );
  },

  createFile: (input, options = {}) => {
    const path = resolvePath(input);

    if (options.intermediates) {
      mkdirSync(dirname(path), { recursive: true });
    }

    if (!options.overwrite && existsSync(path)) {
      throw new Error(`File already exists: ${path}`);
    }

    writeFileSync(path, "", { flag: options.overwrite ? "w" : "wx" });
  },

  createDirectory: (input, options: CreateDirectoryOptions = {}) => {
    const path = resolvePath(input);

    if (!options.intermediates && !options.idempotent) {
      mkdirSync(path);

      return;
    }

    mkdirSync(path, { recursive: true });
  },

  writeFile: (input, contents, options: FileWriteOptions = {}) => {
    const path = resolvePath(input);

    mkdirSync(dirname(path), { recursive: true });

    if (options.encoding === "base64") {
      writeFileSync(path, Buffer.from(contents, "base64"), {
        flag: options.append ? "a" : "w",
      });

      return;
    }

    writeFileSync(path, contents, {
      encoding: "utf8",
      flag: options.append ? "a" : "w",
    });
  },

  readTextFile: (input) => readFileSync(resolvePath(input), "utf8"),

  readBytesFile: (input) => {
    const buffer = readFileSync(resolvePath(input));

    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  },

  deleteEntry: (input) => {
    rmSync(resolvePath(input), { force: true, recursive: true });
  },

  copyEntry: (from, to, options: RelocationOptions = {}) => {
    const source = resolvePath(from);
    const destination = resolvePath(to);

    if (existsSync(destination) && !options.overwrite) {
      throw new Error(`Destination already exists: ${destination}`);
    }

    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  },

  moveEntry: (from, to, options: RelocationOptions = {}) => {
    const source = resolvePath(from);
    const destination = resolvePath(to);

    if (existsSync(destination) && !options.overwrite) {
      throw new Error(`Destination already exists: ${destination}`);
    }

    mkdirSync(dirname(destination), { recursive: true });

    try {
      renameSync(source, destination);
    } catch {
      // `rename` fails across devices, which happens when the target is a
      // removable drive or a user-picked folder.
      copyFileSync(source, destination);
      rmSync(source, { force: true, recursive: true });
    }
  },

  rename: (input, newName) => {
    const path = resolvePath(input);
    const destination = join(dirname(path), newName);

    mkdirSync(dirname(destination), { recursive: true });

    try {
      renameSync(path, destination);
    } catch {
      copyFileSync(path, destination);
      rmSync(path, { force: true, recursive: true });
    }

    return destination;
  },

  contentUri: (input) => toFileUri(resolvePath(input)),

  availableDiskSpace: () => {
    const root = allowedRoots.values().next().value;

    if (typeof root !== "string") {
      return 0;
    }

    try {
      const info = statfsSync(root);

      return info.bsize * info.bavail;
    } catch {
      return 0;
    }
  },
};

/** Asynchronous half, reached through `ipcRenderer.invoke`. */
export const filesystem: DesktopFsAsync = {
  stat: (input) => describe(resolvePath(input)),

  /**
   * Mirrors `File.downloadFileAsync`.
   *
   * `expo-file-system` accepts a `File` or `Directory` as the destination; the
   * renderer shim resolves it to a path before crossing the bridge.
   */
  downloadFile: async (url, destination, options = {}) => {
    const path = resolvePath(destination);

    if (existsSync(path) && !options.idempotent) {
      throw new Error(`Destination already exists: ${path}`);
    }

    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(
        `Download failed (${response.status} ${response.statusText}): ${url}`,
      );
    }

    await mkdir(dirname(path), { recursive: true });
    await pipeline(
      Readable.fromWeb(
        response.body as Parameters<typeof Readable.fromWeb>[0],
      ),
      createWriteStream(path),
    );

    return describe(path);
  },

  pickDirectory: async () => {
    // Implemented in the main entry point, which owns the Electron dialog.
    throw new Error("pickDirectory must be handled by the main process.");
  },
};
