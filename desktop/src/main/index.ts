import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from "electron";

import { openDesktopDatabase, type DesktopDatabase } from "./database";
import {
  allowPickedRoot,
  allowRoot,
  filesystem,
  filesystemSync,
  isAllowedPath,
} from "./filesystem";
import { secrets } from "./secrets";
import { captureRendererErrors, runSmokeTest } from "./smoke-test";
import type {
  CreateDirectoryOptions,
  CreateFileOptions,
  DesktopAppInfo,
  FileWriteOptions,
  RelocationOptions,
} from "../shared/contract";
import { isInsideRoot } from "../shared/paths";

/**
 * Electron main process.
 *
 * Owns everything the renderer is not allowed to touch directly: the SQLite
 * database, the filesystem, and encrypted secret storage. The renderer reaches
 * all of it through the narrow `window.desktop` bridge installed by the preload
 * script.
 */

/**
 * Directory holding the exported web bundle.
 *
 * `__dirname` is `desktop/out/main` when running from source and
 * `<install>/resources/app.asar/out/main` once packaged, so the two locations are
 * *not* the same number of levels apart and cannot be reached by one relative
 * path. The two cases are therefore spelled out rather than probed in sequence:
 *
 *   - packaged: `electron-builder` copies `dist/web` to `resources/web`, which is
 *     four levels above `app.asar/out/main` (out, app.asar, resources, install).
 *     A packaged build must never reach back into the source tree.
 *   - development: `dist/web` sits at the repository root, three levels above
 *     `desktop/out/main` (out, desktop, repo).
 */
const WEB_ROOT = app.isPackaged
  ? resolve(__dirname, "../../../web")
  : resolve(__dirname, "../../../dist/web");

/**
 * Set to an Metro dev-server URL to load the renderer from there instead of the
 * exported bundle.
 */
const DEV_SERVER_URL = process.env.MOBILE_AGENT_DEV_SERVER_URL;

/**
 * URL schemes the renderer may hand to the operating system.
 *
 * The renderer chooses these strings, so the list is closed. `file:` is here
 * because the app opens workspace files that way, and it is additionally
 * checked against the filesystem allow-list before being used.
 */
const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto", "file"]);

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let mainWindow: BrowserWindow | null = null;
let database: DesktopDatabase | null = null;

/**
 * Serialises database access.
 *
 * Drizzle's `sqlite-proxy` driver implements `transaction()` by issuing
 * `BEGIN` / `COMMIT` as ordinary statements over this same channel. Letting two
 * transactions interleave on one connection would corrupt them, so every query
 * is queued behind the previous one.
 */
let databaseQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const result = databaseQueue.then(task, task);

  databaseQueue = result.catch(() => undefined);

  return result;
}

function getDatabase(): DesktopDatabase {
  if (!database) {
    throw new Error("The database is not open yet.");
  }

  return database;
}

function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Resolves a request path to a file inside the exported bundle.
 *
 * The bundle is a single-page app (`web.output: "single"`), so there is exactly
 * one document and every other path belongs to the client-side router. Returns
 * `null` for anything that is not a real file, which the caller turns into the
 * shell document.
 */
async function resolveBundleFile(pathname: string): Promise<string | null> {
  const requested = decodeURIComponent(pathname);
  const base = resolve(join(WEB_ROOT, normalize(requested)));

  // Never serve anything above the bundle root.
  if (!isInsideRoot(WEB_ROOT, base)) {
    return null;
  }

  try {
    const info = await stat(base);

    return info.isFile() ? base : null;
  } catch {
    return null;
  }
}

async function serveWebBundle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target =
    (await resolveBundleFile(url.pathname)) ?? join(WEB_ROOT, "index.html");

  try {
    const body = await readFile(target);

    return new Response(body, {
      status: 200,
      headers: {
        "content-type":
          MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        // The renderer is fully local, but Chromium still enforces CORS on
        // font and stylesheet loads. Echoing an allow-origin for this scheme
        // keeps them same-origin and avoids per-asset failures.
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return new Response(
      `Renderer bundle not found at ${WEB_ROOT}. Run \`pnpm desktop:build\` first.`,
      { status: 500, headers: { "content-type": "text/plain" } },
    );
  }
}

function registerIpc(): void {
  // --- app ---------------------------------------------------------------
  const info = (): DesktopAppInfo => ({
    platform: process.platform,
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? "",
    databasePath: getDatabase().file,
    documentsPath: app.getPath("documents"),
    tempPath: app.getPath("temp"),
  });

  // The preload script needs this synchronously, before the first page script
  // runs, so that the `expo-file-system` shim can resolve `Paths.document`.
  registerSync("app:info", info);

  // --- filesystem --------------------------------------------------------
  registerSync("fs:stat", (path: string) => filesystemSync.stat(path));
  registerSync("fs:list", (path: string) => filesystemSync.list(path));
  registerSync("fs:createFile", (path: string, options: CreateFileOptions) =>
    filesystemSync.createFile(path, options),
  );
  registerSync(
    "fs:createDirectory",
    (path: string, options: CreateDirectoryOptions) =>
      filesystemSync.createDirectory(path, options),
  );
  registerSync(
    "fs:writeFile",
    (path: string, contents: string, options: FileWriteOptions) =>
      filesystemSync.writeFile(path, contents, options),
  );
  registerSync("fs:readTextFile", (path: string) =>
    filesystemSync.readTextFile(path),
  );
  registerSync("fs:readBytesFile", (path: string) =>
    filesystemSync.readBytesFile(path),
  );
  registerSync("fs:deleteEntry", (path: string) =>
    filesystemSync.deleteEntry(path),
  );
  registerSync(
    "fs:copyEntry",
    (from: string, to: string, options: RelocationOptions) =>
      filesystemSync.copyEntry(from, to, options),
  );
  registerSync(
    "fs:moveEntry",
    (from: string, to: string, options: RelocationOptions) =>
      filesystemSync.moveEntry(from, to, options),
  );
  registerSync("fs:rename", (path: string, newName: string) =>
    filesystemSync.rename(path, newName),
  );
  registerSync("fs:contentUri", (path: string) =>
    filesystemSync.contentUri(path),
  );
  registerSync("fs:availableDiskSpace", () =>
    filesystemSync.availableDiskSpace(),
  );

  ipcMain.handle("fs:statAsync", (_event, path: string) => filesystem.stat(path));
  ipcMain.handle("fs:downloadFile", (_event, url, destination, options) =>
    filesystem.downloadFile(url, destination, options),
  );
  ipcMain.handle("fs:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a folder",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const [chosen] = result.filePaths;

    allowPickedRoot(chosen);

    return chosen;
  });

  // --- secrets -----------------------------------------------------------
  ipcMain.handle("secrets:get", (_event, key: string) => secrets.get(key));
  ipcMain.handle("secrets:set", (_event, key: string, value: string) =>
    secrets.set(key, value),
  );
  ipcMain.handle("secrets:delete", (_event, key: string) =>
    secrets.delete(key),
  );

  // --- database ----------------------------------------------------------
  ipcMain.handle("db:query", (_event, sql: string, params: unknown[]) =>
    enqueue(() => getDatabase().query(sql, params ?? [])),
  );

  // --- shell -------------------------------------------------------------
  ipcMain.handle("shell:openExternal", async (_event, target: string) => {
    // The renderer supplies the target string, so treat it as untrusted: a
    // blanket `openExternal` would let a compromised page launch arbitrary
    // protocol handlers, including ones registered by other applications.
    const scheme = target.slice(0, target.indexOf(":")).toLowerCase();

    if (!EXTERNAL_SCHEMES.has(scheme)) {
      throw new Error(
        `Refusing to open "${target}": the "${scheme || "?"}" scheme is not on the list of link targets this app may open.`,
      );
    }

    // A `file:` target is just as much a filesystem read as one handed to the
    // filesystem bridge, so it goes through the same allow-list.
    if (scheme === "file" && !isAllowedPath(target)) {
      throw new Error(
        `Refusing to open "${target}": it is outside the directories this app may use.`,
      );
    }

    await shell.openExternal(target);
  });
}

/**
 * Registers a handler for `ipcRenderer.sendSync`.
 *
 * `sendSync` cannot deliver a rejected promise, so failures are returned as a
 * tagged object and re-thrown on the renderer side by the preload's `unwrap`.
 */
function registerSync<T>(
  channel: string,
  handler: (...args: never[]) => T,
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    try {
      event.returnValue = (handler as (...values: unknown[]) => T)(...args);
    } catch (error) {
      event.returnValue = {
        __error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: "#0b0b0d",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // External links open in the user's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: "deny" };
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    // The bare origin, not `/index.html`. Expo Router routes on `pathname`, and
    // `app://local/index.html` has the pathname `/index.html`, which matches no
    // route and lands on the "Unmatched Route" screen.
    void window.loadURL("app://local/");
  }

  return window;
}

/**
 * Headless verification mode. See `smoke-test.ts` for what it covers.
 *
 * `process.argv` rather than an env var because the flag reads better at a
 * glance in a terminal and cannot be set accidentally by a parent process.
 */
const SMOKE_TEST =
  process.argv.includes("--smoke-test") ||
  process.env.MOBILE_AGENT_SMOKE_TEST === "1";

async function bootstrap(): Promise<void> {
  for (const directory of [
    app.getPath("userData"),
    app.getPath("documents"),
    app.getPath("temp"),
    app.getPath("downloads"),
    app.getPath("desktop"),
  ]) {
    allowRoot(directory);
  }

  database = await openDesktopDatabase(app.getPath("userData"));

  protocol.handle("app", serveWebBundle);
  registerIpc();

  mainWindow = createWindow();

  if (!SMOKE_TEST || !mainWindow) {
    return;
  }

  const window = mainWindow;

  // Attached before the page loads, so mount-time errors are still buffered.
  captureRendererErrors(window);

  window.webContents.once("did-finish-load", () => {
    void runSmokeTest(window).then((code) => {
      app.exit(code);
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Must run at module scope, before `app.whenReady()`. Registering the scheme
  // later has no effect, and without `standard: true` the `app://` origin stays
  // opaque: relative `new URL()` calls throw "Invalid base URL" and every
  // subresource, fonts included, is treated as a cross-origin request from
  // `null` and blocked.
  registerScheme();

  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  void app.whenReady().then(bootstrap);

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}
