import * as Crypto from "expo-crypto";
import type { DocumentPickerAsset } from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";

import type { WorkspaceRepository } from "@/lib/db/database";
import type { WorkspaceFile } from "@/types/app-state";

const WORKSPACE_ROOT_SEGMENTS = ["mobile-agent", "workspace"] as const;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-typescript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-yaml",
]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".xml",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".sh",
  ".env",
  ".csv",
  ".log",
]);

function sanitizeFileName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return "untitled.txt";
  }

  const normalized = trimmed
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "untitled.txt";
}

function sanitizePathSegment(name: string) {
  return sanitizeFileName(name).replace(/\.+/g, ".");
}

function buildRelativePath(id: string, fileName: string) {
  return `${id}-${sanitizeFileName(fileName)}`;
}

function buildManagedRelativePath(input: {
  folderSegments?: string[];
  id: string;
  name: string;
}) {
  const prefix = (input.folderSegments ?? [])
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean);

  return [...prefix, buildRelativePath(input.id, input.name)].join("/");
}

export function getWorkspaceDirectory() {
  return new Directory(Paths.document, ...WORKSPACE_ROOT_SEGMENTS);
}

export function resolveWorkspaceFile(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);

  return new File(getWorkspaceDirectory(), ...segments);
}

export function isTextWorkspaceFile(file: Pick<WorkspaceFile, "displayName" | "mimeType">) {
  const mimeType = file.mimeType?.toLowerCase() ?? "";

  if (
    TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(mimeType)
  ) {
    return true;
  }

  const lowerName = file.displayName.toLowerCase();

  for (const extension of TEXT_EXTENSIONS) {
    if (lowerName.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

export type WorkspaceFileService = ReturnType<typeof createWorkspaceFileService>;

export function createWorkspaceFileService(repository: WorkspaceRepository) {
  async function ensureWorkspaceDirectory() {
    const directory = getWorkspaceDirectory();

    if (!directory.exists) {
      directory.create({
        idempotent: true,
        intermediates: true,
      });
    }

    return directory;
  }

  return {
    ensureWorkspaceDirectory,
    async importDocument(asset: DocumentPickerAsset) {
      const id = Crypto.randomUUID();
      const displayName = sanitizeFileName(asset.name || "imported-file");
      const relativePath = buildRelativePath(id, displayName);

      await ensureWorkspaceDirectory();

      const sourceFile = new File(asset.uri);
      const destinationFile = resolveWorkspaceFile(relativePath);

      await sourceFile.copy(destinationFile, { overwrite: true });

      return repository.create({
        id,
        displayName,
        mimeType: asset.mimeType ?? null,
        originalName: asset.name ?? null,
        relativePath,
        size: asset.size ?? destinationFile.size ?? null,
        sourceKind: "imported",
      });
    },
    async createTextFile(input: {
      content: string;
      mimeType?: string | null;
      name: string;
    }) {
      const id = Crypto.randomUUID();
      const displayName = sanitizeFileName(input.name);
      const relativePath = buildRelativePath(id, displayName);

      await ensureWorkspaceDirectory();

      const file = resolveWorkspaceFile(relativePath);
      file.create({
        intermediates: true,
        overwrite: true,
      });
      file.write(input.content);

      return repository.create({
        id,
        displayName,
        mimeType: input.mimeType ?? "text/plain",
        originalName: displayName,
        relativePath,
        size: file.size ?? input.content.length,
        sourceKind: "created",
      });
    },
    async createManagedTextFile(input: {
      content: string;
      folderSegments?: string[];
      mimeType?: string | null;
      name: string;
    }) {
      const id = Crypto.randomUUID();
      const displayName = sanitizeFileName(input.name);
      const relativePath = buildManagedRelativePath({
        folderSegments: input.folderSegments,
        id,
        name: displayName,
      });

      await ensureWorkspaceDirectory();

      const file = resolveWorkspaceFile(relativePath);
      file.create({
        intermediates: true,
        overwrite: true,
      });
      file.write(input.content);

      return repository.create({
        id,
        displayName,
        mimeType: input.mimeType ?? "text/plain",
        originalName: displayName,
        relativePath,
        size: file.size ?? input.content.length,
        sourceKind: "created",
      });
    },
    async readTextFile(workspaceFile: WorkspaceFile) {
      if (!isTextWorkspaceFile(workspaceFile)) {
        throw new Error(`${workspaceFile.displayName} is not a readable text file.`);
      }

      const file = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!file.exists) {
        throw new Error(`${workspaceFile.displayName} is no longer available locally.`);
      }

      return file.text();
    },
    async writeTextFile(
      workspaceFile: WorkspaceFile,
      content: string,
      mode: "append" | "overwrite" = "overwrite",
    ) {
      if (!isTextWorkspaceFile(workspaceFile)) {
        throw new Error(`${workspaceFile.displayName} is not a writable text file.`);
      }

      const file = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!file.exists) {
        file.create({
          intermediates: true,
          overwrite: true,
        });
      }

      file.write(content, { append: mode === "append" });

      await repository.updateMetadata(workspaceFile.id, {
        size: file.size ?? null,
      });

      const nextFile = await repository.getById(workspaceFile.id);

      if (!nextFile) {
        throw new Error("Workspace file metadata is unavailable.");
      }

      return nextFile;
    },
  };
}
