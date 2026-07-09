import { Directory, File } from "expo-file-system";
import { Platform } from "react-native";

import type {
  ExternalFolderPlatform,
  ExternalFolderSession,
} from "@/types/app-state";

export type ExternalFolderEntry = {
  path: string;
  kind: "directory" | "file";
  name: string;
  mimeType: string | null;
  size: number | null;
};

function normalizePlatform(): ExternalFolderPlatform {
  if (Platform.OS === "android") {
    return "android";
  }

  if (Platform.OS === "ios") {
    return "ios";
  }

  return "web";
}

function getRootDirectory(session: ExternalFolderSession) {
  return new Directory(session.uri);
}

function splitRelativePath(path: string) {
  const normalized = path.replace(/\\/g, "/").trim();

  if (!normalized || normalized === ".") {
    return [];
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    normalized.includes("://")
  ) {
    throw new Error("Use a path relative to the granted folder.");
  }

  const parts = normalized
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.some((part) => part === "..")) {
    throw new Error("Parent traversal is not allowed outside the granted folder.");
  }

  return parts.filter((part) => part !== ".");
}

function getRelativePath(path: string) {
  return splitRelativePath(path).join("/");
}

function findChildDirectory(parent: Directory, name: string) {
  return (
    parent
      .list()
      .find((entry): entry is Directory => entry instanceof Directory && entry.name === name) ??
    null
  );
}

function findChildFile(parent: Directory, name: string) {
  return (
    parent
      .list()
      .find((entry): entry is File => entry instanceof File && entry.name === name) ??
    null
  );
}

function resolveDirectory(session: ExternalFolderSession, path = "") {
  const parts = splitRelativePath(path);
  let current = getRootDirectory(session);

  for (const part of parts) {
    const next = findChildDirectory(current, part);

    if (!next) {
      throw new Error(`No folder exists at "${parts.join("/")}".`);
    }

    current = next;
  }

  return current;
}

function resolveFile(session: ExternalFolderSession, path: string) {
  const parts = splitRelativePath(path);

  if (parts.length === 0) {
    throw new Error("A file path is required.");
  }

  const fileName = parts[parts.length - 1];
  const parent = parts.length > 1
    ? resolveDirectory(session, parts.slice(0, -1).join("/"))
    : getRootDirectory(session);
  const file = findChildFile(parent, fileName);

  if (!file) {
    throw new Error(`No file exists at "${parts.join("/")}".`);
  }

  return file;
}

function ensureParentDirectoryExists(session: ExternalFolderSession, path: string) {
  const parts = splitRelativePath(path);

  if (parts.length <= 1) {
    return getRootDirectory(session);
  }
  const parent = resolveDirectory(session, parts.slice(0, -1).join("/"));

  if (!parent.exists) {
    throw new Error("The destination folder does not exist yet.");
  }

  return parent;
}

function getEntryPath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

async function waitForCondition(
  predicate: () => boolean,
  errorMessage: string,
  attempts = 5,
  delayMs = 150,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(errorMessage);
}

async function assertFileVisible(session: ExternalFolderSession, path: string) {
  const parts = splitRelativePath(path);
  const name = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join("/");
  const parent = resolveDirectory(session, parentPath);

  if (!parent.exists) {
    throw new Error("The destination folder is no longer available.");
  }

  await waitForCondition(
    () => parent.list().some((entry) => entry.name === name),
    `The file "${getRelativePath(path)}" was not visible after the write completed.`,
  );
}

async function assertDirectoryVisible(session: ExternalFolderSession, path: string) {
  const parts = splitRelativePath(path);
  const name = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join("/");
  const parent = resolveDirectory(session, parentPath);

  if (!parent.exists) {
    throw new Error("The destination folder is no longer available.");
  }

  await waitForCondition(
    () => parent.list().some((entry) => entry.name === name),
    `The folder "${getRelativePath(path)}" was not visible after creation.`,
  );
}

async function assertEntryAbsent(session: ExternalFolderSession, path: string) {
  const relativePath = getRelativePath(path);

  await waitForCondition(
    () => {
      try {
        resolveExistingEntry(session, relativePath);
        return false;
      } catch {
        return true;
      }
    },
    `The entry "${relativePath}" is still visible after delete was reported.`,
  );
}

function resolveExistingEntry(session: ExternalFolderSession, path: string) {
  const relativePath = getRelativePath(path);

  try {
    const directory = resolveDirectory(session, relativePath);

    if (directory.exists) {
      return directory;
    }
  } catch {}

  try {
    const file = resolveFile(session, relativePath);

    if (file.exists) {
      return file;
    }
  } catch {}

  throw new Error(`No file or folder exists at "${relativePath || "."}".`);
}

export function createExternalFolderService() {
  return {
    async pickDirectory(
      initialUri?: string,
    ): Promise<ExternalFolderSession> {
      const directory = await Directory.pickDirectoryAsync(initialUri);

      return {
        uri: directory.uri,
        displayName: directory.name || "Selected folder",
        platform: normalizePlatform(),
        sourceType: "external-folder",
        grantedAt: new Date().toISOString(),
      };
    },
    listEntries(session: ExternalFolderSession, path = ""): ExternalFolderEntry[] {
      const directory = resolveDirectory(session, path);

      if (!directory.exists) {
        throw new Error("The granted folder is no longer available.");
      }

      return directory.list().map((entry) => {
        const isDirectory = entry instanceof Directory;

        return {
          path: getEntryPath(getRelativePath(path), entry.name),
          kind: isDirectory ? "directory" : "file",
          name: entry.name,
          mimeType: isDirectory ? null : (entry.type || null),
          size: entry.size ?? null,
        };
      });
    },
    async readTextFile(
      session: ExternalFolderSession,
      path: string,
      maxChars?: number,
    ) {
      const file = resolveFile(session, path);

      const text = await file.text();

      return typeof maxChars === "number" ? text.slice(0, maxChars) : text;
    },
    async createTextFile(
      session: ExternalFolderSession,
      path: string,
      content: string,
    ) {
      const parts = splitRelativePath(path);
      const fileName = parts[parts.length - 1];
      const parent = ensureParentDirectoryExists(session, path);
      let file = findChildFile(parent, fileName);

      if (!file) {
        file = parent.createFile(fileName, inferMimeType(fileName));
      }

      file.write(content);
      await assertFileVisible(session, path);

      return {
        path: getRelativePath(path),
        size: file.size,
      };
    },
    async writeTextFile(
      session: ExternalFolderSession,
      path: string,
      content: string,
      mode: "append" | "overwrite" = "overwrite",
    ) {
      const parts = splitRelativePath(path);
      const fileName = parts[parts.length - 1];
      const parent = ensureParentDirectoryExists(session, path);
      let file = findChildFile(parent, fileName);

      if (!file) {
        file = parent.createFile(fileName, inferMimeType(fileName));
      }

      file.write(content, { append: mode === "append" });
      await assertFileVisible(session, path);

      return {
        path: getRelativePath(path),
        size: file.size,
      };
    },
    async createDirectory(session: ExternalFolderSession, path: string) {
      const parts = splitRelativePath(path);
      let current = getRootDirectory(session);

      for (const part of parts) {
        const existing = findChildDirectory(current, part);

        if (existing) {
          current = existing;
          continue;
        }

        current = current.createDirectory(part);
      }

      await assertDirectoryVisible(session, path);

      return {
        path: getRelativePath(path),
      };
    },
    async moveEntry(
      session: ExternalFolderSession,
      fromPath: string,
      toPath: string,
    ) {
      const entry = resolveExistingEntry(session, fromPath);
      const nextRelativePath = getRelativePath(toPath);
      const destination =
        entry instanceof Directory
          ? resolveDirectory(session, nextRelativePath)
          : resolveFile(session, nextRelativePath);

      ensureParentDirectoryExists(session, nextRelativePath);
      await entry.move(destination);

      if (entry instanceof Directory) {
        await assertDirectoryVisible(session, nextRelativePath);
      } else {
        await assertFileVisible(session, nextRelativePath);
      }

      return {
        fromPath: getRelativePath(fromPath),
        toPath: nextRelativePath,
      };
    },
    async renameEntry(session: ExternalFolderSession, path: string, newName: string) {
      const trimmedName = newName.trim();

      if (!trimmedName || trimmedName.includes("/") || trimmedName.includes("\\")) {
        throw new Error("Provide a valid file or folder name.");
      }

      const entry = resolveExistingEntry(session, path);
      const previousPath = getRelativePath(path);

      entry.rename(trimmedName);

      const parts = splitRelativePath(previousPath);
      parts[parts.length - 1] = trimmedName;

      const nextPath = parts.join("/");

      if (entry instanceof Directory) {
        await assertDirectoryVisible(session, nextPath);
      } else {
        await assertFileVisible(session, nextPath);
      }

      return {
        path: nextPath,
        previousPath,
      };
    },
    async deleteEntry(
      session: ExternalFolderSession,
      path: string,
      recursive = false,
    ) {
      const entry = resolveExistingEntry(session, path);
      const relativePath = getRelativePath(path);

      if (entry instanceof Directory && !recursive && entry.list().length > 0) {
        throw new Error(
          "Folder is not empty. Set recursive to true to delete it.",
        );
      }

      entry.delete();
      await assertEntryAbsent(session, relativePath);

      return {
        path: relativePath,
      };
    },
  };
}

function inferMimeType(fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".json")) {
    return "application/json";
  }

  if (lowerName.endsWith(".js") || lowerName.endsWith(".mjs")) {
    return "application/javascript";
  }

  if (lowerName.endsWith(".css")) {
    return "text/css";
  }

  if (lowerName.endsWith(".html")) {
    return "text/html";
  }

  if (lowerName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (lowerName.endsWith(".xml")) {
    return "application/xml";
  }

  if (lowerName.endsWith(".md")) {
    return "text/markdown";
  }

  if (lowerName.endsWith(".txt")) {
    return "text/plain";
  }

  return "text/plain";
}
