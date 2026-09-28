import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, safeStorage } from "electron";

/**
 * Key/value secret storage for the renderer, replacing `expo-secure-store`.
 *
 * Values are encrypted with Electron's `safeStorage`, which is DPAPI-backed on
 * Windows and therefore scoped to the logged-in user account. The encrypted
 * blob lives in a single JSON file under `userData`.
 *
 * Android's `expo-secure-store` is also per-app storage with no export, so the
 * two are equivalent in capability: neither can be read by another app.
 */

interface SecretsFile {
  version: 1;
  entries: Record<string, string>;
}

let cache: Record<string, string> | null = null;
let filePath: string | null = null;

function getFilePath(): string {
  filePath ??= join(app.getPath("userData"), "secrets.json");

  return filePath;
}

function load(): Record<string, string> {
  if (cache) {
    return cache;
  }

  const path = getFilePath();

  if (!existsSync(path)) {
    cache = {};

    return cache;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SecretsFile;

    cache = parsed.version === 1 && parsed.entries ? parsed.entries : {};
  } catch {
    // A corrupt or partially written file must not stop the app from starting.
    // Losing stored API keys is recoverable; refusing to launch is not.
    console.warn("[secrets] could not read secrets file, starting empty");
    cache = {};
  }

  return cache;
}

function persist(): void {
  if (!cache) {
    return;
  }

  const path = getFilePath();
  const payload: SecretsFile = { version: 1, entries: cache };

  // Write-then-rename so a crash mid-write cannot truncate the file.
  const temporary = `${path}.tmp`;

  writeFileSync(temporary, JSON.stringify(payload), "utf8");
  renameSync(temporary, path);
}

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export const secrets = {
  get(key: string): string | null {
    const entries = load();
    const stored = entries[key];

    if (stored === undefined) {
      return null;
    }

    if (!isEncryptionAvailable()) {
      return stored;
    }

    try {
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      return null;
    }
  },

  set(key: string, value: string): void {
    const entries = load();

    if (isEncryptionAvailable()) {
      entries[key] = safeStorage.encryptString(value).toString("base64");
    } else {
      console.warn(
        "[secrets] OS encryption unavailable; storing secrets unencrypted",
      );
      entries[key] = value;
    }

    persist();
  },

  delete(key: string): void {
    const entries = load();

    if (key in entries) {
      delete entries[key];
      persist();
    }
  },
};
