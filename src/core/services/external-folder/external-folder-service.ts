import { Directory, File } from "expo-file-system";
import { Platform } from "react-native";
import {
  createSafEntry,
  relocateSafEntry,
} from "saf-file-operations";

import type {
  ExternalFolderPlatform,
  ExternalFolderSession,
} from "@/core/types/app-state";

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

function isAndroidSafSession(session: ExternalFolderSession) {
  return Platform.OS === "android" && session.uri.startsWith("content://");
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

function tryResolveEntry(
  session: ExternalFolderSession,
  path: string,
): Directory | File | null {
  try {
    return resolveExistingEntry(session, path);
  } catch {
    return null;
  }
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
        file = isAndroidSafSession(session)
          ? new File(
              await createSafEntry(
                session.uri,
                parent.uri,
                fileName,
                inferMimeType(fileName),
                false,
              ),
            )
          : parent.createFile(fileName, inferMimeType(fileName));
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
        file = isAndroidSafSession(session)
          ? new File(
              await createSafEntry(
                session.uri,
                parent.uri,
                fileName,
                inferMimeType(fileName),
                false,
              ),
            )
          : parent.createFile(fileName, inferMimeType(fileName));
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

        current = isAndroidSafSession(session)
          ? new Directory(
              await createSafEntry(
                session.uri,
                current.uri,
                part,
                null,
                true,
              ),
            )
          : current.createDirectory(part);
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
      const fromRelativePath = getRelativePath(fromPath);
      const nextRelativePath = getRelativePath(toPath);

      if (!fromRelativePath) {
        throw new Error("Cannot move the granted folder itself.");
      }

      if (!nextRelativePath) {
        throw new Error("A destination path is required.");
      }

      if (nextRelativePath === fromRelativePath) {
        throw new Error("Source and destination are the same path.");
      }

      if (
        entry instanceof Directory &&
        nextRelativePath.startsWith(`${fromRelativePath}/`)
      ) {
        throw new Error("A folder cannot be moved into its own contents.");
      }

      const destinationParts = splitRelativePath(nextRelativePath);
      const destinationName = destinationParts[destinationParts.length - 1];
      const parent = ensureParentDirectoryExists(session, nextRelativePath);
      const existingDestination = tryResolveEntry(session, nextRelativePath);
      const sourceParts = splitRelativePath(fromRelativePath);
      const sourceParent = resolveDirectory(
        session,
        sourceParts.slice(0, -1).join("/"),
      );

      let finalPath: string;

      if (existingDestination instanceof Directory) {
        if (
          existingDestination
            .list()
            .some((sibling) => sibling.name === entry.name)
        ) {
          throw new Error(
            `"${entry.name}" already exists at "${nextRelativePath}". Delete it first or choose a different destination.`,
          );
        }

        finalPath = `${nextRelativePath}/${entry.name}`;
      } else if (existingDestination instanceof File) {
        throw new Error(
          `A file already exists at "${nextRelativePath}". Delete it first or choose a different destination.`,
        );
      } else {
        finalPath = nextRelativePath;
      }

      if (isAndroidSafSession(session)) {
        const destinationParent =
          existingDestination instanceof Directory
            ? existingDestination
            : parent;
        const finalName =
          existingDestination instanceof Directory
            ? entry.name
            : destinationName;

        await relocateSafEntry(
          session.uri,
          entry.uri,
          sourceParent.uri,
          destinationParent.uri,
          finalName,
        );
      } else {
        const destination =
          existingDestination instanceof Directory
            ? existingDestination
            : entry instanceof Directory
              ? new Directory(parent.uri, destinationName)
              : new File(parent.uri, destinationName);
        await entry.move(destination, { overwrite: false });
      }

      if (entry instanceof Directory) {
        await assertDirectoryVisible(session, finalPath);
      } else {
        await assertFileVisible(session, finalPath);
      }
      await assertEntryAbsent(session, fromRelativePath);

      return {
        fromPath: fromRelativePath,
        toPath: finalPath,
      };
    },
    async renameEntry(session: ExternalFolderSession, path: string, newName: string) {
      const trimmedName = newName.trim();

      if (
        !trimmedName ||
        trimmedName === "." ||
        trimmedName === ".." ||
        trimmedName.includes("/") ||
        trimmedName.includes("\\")
      ) {
        throw new Error("Provide a valid file or folder name.");
      }

      const parts = splitRelativePath(path);

      if (parts.length === 0) {
        throw new Error("Cannot rename the granted folder itself.");
      }

      const entry = resolveExistingEntry(session, path);
      const previousPath = getRelativePath(path);

      if (trimmedName === parts[parts.length - 1]) {
        return {
          path: previousPath,
          previousPath,
        };
      }

      const parentPath = parts.slice(0, -1).join("/");
      const parent = resolveDirectory(session, parentPath);

      if (parent.list().some((sibling) => sibling.name === trimmedName)) {
        throw new Error(
          `A file or folder named "${trimmedName}" already exists at "${previousPath}".`,
        );
      }

      const nextParts = [...parts];
      nextParts[nextParts.length - 1] = trimmedName;

      const nextPath = nextParts.join("/");

      if (isAndroidSafSession(session)) {
        await relocateSafEntry(
          session.uri,
          entry.uri,
          parent.uri,
          parent.uri,
          trimmedName,
        );
      } else {
        entry.rename(trimmedName);
      }

      if (entry instanceof Directory) {
        await assertDirectoryVisible(session, nextPath);
      } else {
        await assertFileVisible(session, nextPath);
      }
      await assertEntryAbsent(session, previousPath);

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

  return "application/octet-stream";
}
