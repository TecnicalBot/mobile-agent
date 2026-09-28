import { contextBridge, ipcRenderer } from "electron";

import type {
  DesktopAppInfo,
  DesktopBridge,
  DesktopFileStat,
} from "../shared/contract";

/**
 * Preload script.
 *
 * Runs in an isolated world with `contextIsolation: true`, `sandbox: true` and
 * `nodeIntegration: false`, so the renderer never gets direct access to Node.
 * Everything it can reach is the explicit surface below.
 *
 * `fsSync` uses `sendSync` because `expo-file-system` reads `exists` / `size` /
 * `lastModified` as plain properties and calls `create()` / `write()` /
 * `delete()` / `list()` without awaiting. `sendSync` can only return a
 * structured-cloneable value, so failures arrive as a tagged object rather than
 * a thrown error; {@link unwrap} turns them back into real exceptions.
 */
function unwrap<T>(value: T | { __error: string }): T {
  if (value && typeof value === "object" && "__error" in value) {
    throw new Error((value as { __error: string }).__error);
  }

  return value as T;
}

function send<T>(channel: string, ...args: unknown[]): T {
  return unwrap<T>(ipcRenderer.sendSync(channel, ...args) as T);
}

const bridge: DesktopBridge = {
  app: send<DesktopAppInfo>("app:info"),

  fsSync: {
    stat: (path) => send<DesktopFileStat>("fs:stat", path),
    list: (path) => send<DesktopFileStat[]>("fs:list", path),
    createFile: (path, options) => {
      send<void>("fs:createFile", path, options);
    },
    createDirectory: (path, options) => {
      send<void>("fs:createDirectory", path, options);
    },
    writeFile: (path, contents, options) => {
      send<void>("fs:writeFile", path, contents, options);
    },
    readTextFile: (path) => send<string>("fs:readTextFile", path),
    readBytesFile: (path) => send<Uint8Array>("fs:readBytesFile", path),
    deleteEntry: (path) => {
      send<void>("fs:deleteEntry", path);
    },
    copyEntry: (from, to, options) => {
      send<void>("fs:copyEntry", from, to, options);
    },
    moveEntry: (from, to, options) => {
      send<void>("fs:moveEntry", from, to, options);
    },
    rename: (path, newName) => send<string>("fs:rename", path, newName),
    contentUri: (path) => send<string>("fs:contentUri", path),
    availableDiskSpace: () => send<number>("fs:availableDiskSpace"),
  },

  fs: {
    stat: (path) => ipcRenderer.invoke("fs:statAsync", path),
    downloadFile: (url, destination, options) =>
      ipcRenderer.invoke("fs:downloadFile", url, destination, options),
    pickDirectory: () => ipcRenderer.invoke("fs:pickDirectory"),
  },

  secrets: {
    get: (key) => ipcRenderer.invoke("secrets:get", key),
    set: (key, value) => ipcRenderer.invoke("secrets:set", key, value),
    delete: (key) => ipcRenderer.invoke("secrets:delete", key),
  },

  db: {
    query: (sql, params) => ipcRenderer.invoke("db:query", sql, params),
  },

  shell: {
    openExternal: (target) => ipcRenderer.invoke("shell:openExternal", target),
  },
};

contextBridge.exposeInMainWorld("desktop", bridge);
