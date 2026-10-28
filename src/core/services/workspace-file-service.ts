import * as Crypto from "expo-crypto";
import type { DocumentPickerAsset } from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import { workspacePathSegments } from "@/core/services/workspace-path";
import {
  inferFileNameFromUrl,
  inferMimeType,
  sanitizeFileName,
} from "@/core/services/file-names";
import { extractDocument } from "@/modules/documents/extract";
import {
  buildDocument,
  getDocumentFormat,
  getDocumentFormatFromMimeType,
  isDocumentFile,
  mergeSpecIntoSource,
} from "@/modules/documents";
import type { DocumentFormat } from "@/modules/documents/types";
import { snapshotDocxSpec } from "@/modules/documents/snapshot/docx-snapshot";
import { snapshotPptxSpec } from "@/modules/documents/snapshot/pptx-snapshot";
import { snapshotXlsxSpec } from "@/modules/documents/snapshot/xlsx-snapshot";
import {
  assembleDocumentSections,
  parseSectionContent,
  splitDocumentSections,
} from "@/modules/documents/sections";
import type { WorkspaceRepository } from "@/core/db/database";
import type { DocumentSection, WorkspaceFile } from "@/core/types/app-state";
// Re-exported so existing import paths keep working.
export { inferFileNameFromUrl, sanitizeFileName };

const WORKSPACE_ROOT_SEGMENTS = ["mobile-agent", "workspace"] as const;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/graphql",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-sql",
  "application/x-toml",
  "application/x-typescript",
  "application/x-yaml",
  "application/xml",
  "image/svg+xml",
]);
const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".cfg",
  ".cjs",
  ".conf",
  ".config",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cts",
  ".cxx",
  ".dart",
  ".diff",
  ".dockerfile",
  ".editorconfig",
  ".env",
  ".fish",
  ".gitignore",
  ".go",
  ".gql",
  ".graphql",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".lua",
  ".markdown",
  ".md",
  ".mjs",
  ".mts",
  ".npmignore",
  ".patch",
  ".php",
  ".prisma",
  ".proto",
  ".py",
  ".pyw",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsv",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const EXACT_TEXT_FILENAMES = new Set([
  ".babelrc",
  ".editorconfig",
  ".env",
  ".env.development",
  ".env.local",
  ".env.production",
  ".eslintrc",
  ".gitignore",
  ".npmignore",
  ".prettierrc",
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "procfile",
  "readme",
]);

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
  const segments = workspacePathSegments(relativePath);

  return new File(getWorkspaceDirectory(), ...segments);
}

/**
 * Read a workspace image by workspace-relative path, used by document
 * builders to embed `![alt](images/logo.png)` references.
 */
export async function readWorkspaceImageBytes(src: string): Promise<Uint8Array> {
  const file = resolveWorkspaceFile(src);

  if (!file.exists) {
    throw new Error(`Image not found in workspace: ${src}`);
  }

  return file.bytes();
}

/**
 * Parse the stored `source_spec` JSON (a document style snapshot) into the plain
 * object used as the `baseSpec` for regeneration. Returns undefined when the
 * file has no snapshot or the value is not a JSON object.
 */
export function parseStoredSourceSpec(
  sourceSpec: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!sourceSpec) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(sourceSpec);

    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function mimeTypeForCreatedContent(fileName: string) {
  const inferred = inferMimeType(fileName);
  return inferred === "application/octet-stream" ? "text/plain" : inferred;
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

  if (EXACT_TEXT_FILENAMES.has(lowerName)) {
    return true;
  }

  for (const extension of TEXT_EXTENSIONS) {
    if (lowerName.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

const VIDEO_MIME_PREFIX = "video/";
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);

/** Videos have no in-app preview kind; they open in the shared player drawer. */
export function isVideoWorkspaceFile(
  file: Pick<WorkspaceFile, "displayName" | "mimeType">,
) {
  if (file.mimeType?.toLowerCase().startsWith(VIDEO_MIME_PREFIX)) {
    return true;
  }

  const extension = file.displayName.split(".").pop()?.toLowerCase();
  return extension ? VIDEO_EXTENSIONS.has(extension) : false;
}

export function isDocumentWorkspaceFile(
  file: Pick<WorkspaceFile, "displayName" | "mimeType">,
) {
  return isDocumentFile(file);
}

async function resolveExpectedContentLength(
  url: string,
  headers?: Record<string, string>,
) {
  try {
    const response = await fetchWithTimeout(
      url,
      { headers: { ...headers, Range: "bytes=0-0" }, method: "GET" },
      8_000,
    );
    const length = response.headers.get("content-range")?.match(/\/\d+$/);

    if (length) {
      return Number.parseInt(length[0]!.slice(1), 10);
    }

    const contentLength = response.headers.get("content-length");

    if (contentLength) {
      return Number.parseInt(contentLength, 10);
    }

    return null;
  } catch {
    return null;
  }
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

  /**
   * Capture the styling of an imported document as a JSON spec so later
   * updates keep the original look. Supported for `.docx`, `.xlsx` and
   * `.pptx`; other formats (and unreadable packages) return null, and
   * failures never block the import itself.
   */
  async function snapshotImportedSpec(
    displayName: string,
    readBytes: () => Promise<Uint8Array>,
  ): Promise<string | null> {
    const format = getDocumentFormat(displayName);

    if (format !== "docx" && format !== "xlsx" && format !== "pptx") {
      return null;
    }

    try {
      const bytes = await readBytes();
      const spec =
        format === "docx"
          ? await snapshotDocxSpec(bytes)
          : format === "xlsx"
            ? await snapshotXlsxSpec(bytes)
            : await snapshotPptxSpec(bytes);

      return spec ? JSON.stringify(spec) : null;
    } catch {
      return null;
    }
  }

  /**
   * Split a document's stored source into heading-delimited sections and
   * persist them, so large documents can be read and updated piecewise.
   */
  async function indexDocumentSections(fileId: string, content: string) {
    const split = splitDocumentSections(content);

    await repository.replaceDocumentSections(
      fileId,
      split.sections.map((section) => ({
        title: section.title,
        level: section.level,
        body: section.body,
      })),
    );
  }

  return {
    ensureWorkspaceDirectory,
    async clearAll() {
      const directory = getWorkspaceDirectory();

      if (directory.exists) {
        directory.delete();
      }

      await repository.deleteAll();
    },
    async deleteFile(workspaceFile: WorkspaceFile) {
      const file = resolveWorkspaceFile(workspaceFile.relativePath);

      if (file.exists) {
        file.delete();
      }

      await repository.delete(workspaceFile.id);
    },
    async importDocument(asset: DocumentPickerAsset) {
      const id = Crypto.randomUUID();
      const displayName = sanitizeFileName(asset.name || "imported-file");
      const relativePath = buildRelativePath(id, displayName);

      await ensureWorkspaceDirectory();

      const sourceFile = new File(asset.uri);
      const destinationFile = resolveWorkspaceFile(relativePath);

      await sourceFile.copy(destinationFile, { overwrite: true });

      const sourceSpec = await snapshotImportedSpec(
        displayName,
        async () => destinationFile.bytes(),
      );

      return repository.create({
        id,
        displayName,
        mimeType: asset.mimeType ?? null,
        originalName: asset.name ?? null,
        relativePath,
        size: asset.size ?? destinationFile.size ?? null,
        sourceKind: "imported",
        sourceSpec,
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
        mimeType: input.mimeType ?? mimeTypeForCreatedContent(displayName),
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
        mimeType: input.mimeType ?? mimeTypeForCreatedContent(displayName),
        originalName: displayName,
        relativePath,
        size: file.size ?? input.content.length,
        sourceKind: "artifact",
      });
    },
    async importBytesFile(input: {
      bytes: Uint8Array;
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
      file.write(input.bytes);

      const sourceSpec = await snapshotImportedSpec(
        displayName,
        async () => input.bytes,
      );

      return repository.create({
        id,
        displayName,
        mimeType: input.mimeType ?? "application/octet-stream",
        originalName: displayName,
        relativePath,
        size: file.size ?? input.bytes.byteLength,
        sourceKind: "imported",
        sourceSpec,
      });
    },
    async createDocumentFile(input: {
      bytes: Uint8Array;
      mimeType: string;
      name: string;
      sourceMarkdown?: string | null;
      sourceSpec?: string | null;
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
      file.write(input.bytes);

      const created = await repository.create({
        id,
        displayName,
        mimeType: input.mimeType,
        originalName: displayName,
        relativePath,
        size: file.size ?? input.bytes.byteLength,
        sourceKind: "created",
        sourceMarkdown: input.sourceMarkdown ?? null,
        sourceSpec: input.sourceSpec ?? null,
      });

      if (created.sourceMarkdown) {
        await indexDocumentSections(created.id, created.sourceMarkdown);
      }

      return created;
    },
    /**
     * Persist an already-finished file (e.g. a rendered MP4 in cache) as a new
     * workspace file by *moving* it into place. Unlike `createDocumentFile`,
     * this never loads the bytes into the JS heap — a 100+ MB video would
     * otherwise OOM the app (heap growth limit is ~256 MB on-device).
     * Source and workspace both live in app-private internal storage, so the
     * move is a same-volume rename.
     */
    async createDocumentFileFromFile(input: {
      source: File;
      mimeType: string;
      name: string;
    }) {
      const id = Crypto.randomUUID();
      const displayName = sanitizeFileName(input.name);
      const relativePath = buildRelativePath(id, displayName);

      await ensureWorkspaceDirectory();

      const file = resolveWorkspaceFile(relativePath);
      await input.source.move(file, { overwrite: true });

      return repository.create({
        id,
        displayName,
        mimeType: input.mimeType,
        originalName: displayName,
        relativePath,
        size: file.size ?? null,
        sourceKind: "created",
      });
    },
    /**
     * Build a document from Markdown source and persist it as a new,
     * source-editable workspace file. `sourceSpec`, when provided, carries an
     * imported document's captured styling so split/merged parts keep the look.
     */
    async createDocumentFromMarkdown(input: {
      format: DocumentFormat;
      name: string;
      source: string;
      sourceSpec?: string | null;
    }) {
      const built = await buildDocument({
        format: input.format,
        content: input.source,
        fileName: input.name,
        baseSpec: parseStoredSourceSpec(input.sourceSpec),
        resolveImage: readWorkspaceImageBytes,
      });

      return this.createDocumentFile({
        bytes: built.bytes,
        mimeType: built.mimeType,
        name: built.fileName,
        sourceMarkdown: input.source,
        sourceSpec: input.sourceSpec ?? null,
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
    async readWorkspaceFileText(workspaceFile: WorkspaceFile) {
      if (isTextWorkspaceFile(workspaceFile)) {
        return this.readTextFile(workspaceFile);
      }

      if (!isDocumentWorkspaceFile(workspaceFile)) {
        throw new Error(
          `${workspaceFile.displayName} is neither a readable text file nor a supported document.`,
        );
      }

      const file = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!file.exists) {
        throw new Error(`${workspaceFile.displayName} is no longer available locally.`);
      }

      const format =
        getDocumentFormat(workspaceFile.displayName) ??
        getDocumentFormatFromMimeType(workspaceFile.mimeType);

      if (!format) {
        throw new Error(
          `${workspaceFile.displayName} is not a supported document format.`,
        );
      }

      const extracted = await extractDocument(format, await file.bytes());
      return extracted.text;
    },
    async readDocumentBytes(workspaceFile: WorkspaceFile) {
      if (!isDocumentWorkspaceFile(workspaceFile)) {
        throw new Error(
          `${workspaceFile.displayName} is not a supported document.`,
        );
      }

      const file = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!file.exists) {
        throw new Error(
          `${workspaceFile.displayName} is no longer available locally.`,
        );
      }

      return file.bytes();
    },
    /**
     * Resolve a document's canonical editable Markdown source: the stored source
     * when present, otherwise the binary document's extracted text. Split/merge
     * use this so imported documents without stored source still work.
     */
    async readDocumentSource(workspaceFile: WorkspaceFile): Promise<string> {
      if (workspaceFile.sourceMarkdown) {
        return workspaceFile.sourceMarkdown;
      }

      if (!isDocumentWorkspaceFile(workspaceFile)) {
        throw new Error(
          `${workspaceFile.displayName} is not a supported document.`,
        );
      }

      const format =
        getDocumentFormat(workspaceFile.displayName) ??
        getDocumentFormatFromMimeType(workspaceFile.mimeType);

      if (!format) {
        throw new Error(
          `${workspaceFile.displayName} is not a supported document format.`,
        );
      }

      const extracted = await extractDocument(
        format,
        await this.readDocumentBytes(workspaceFile),
      );

      return extracted.text;
    },
    /**
     * Regenerate an existing document in place from Markdown/plain-text source.
     * The document keeps its format and file name; the binary bytes and the
     * stored source are replaced so the document can be updated again later.
     * An optional format `spec` is persisted into the stored source's YAML
     * front-matter so the styling survives future updates without restyling.
     */
    async updateDocumentFile(
      workspaceFile: WorkspaceFile,
      sourceMarkdown: string,
      spec?: Record<string, unknown>,
    ) {
      if (!isDocumentWorkspaceFile(workspaceFile)) {
        throw new Error(
          `${workspaceFile.displayName} is not a supported document.`,
        );
      }

      const format =
        getDocumentFormat(workspaceFile.displayName) ??
        getDocumentFormatFromMimeType(workspaceFile.mimeType);

      if (!format) {
        throw new Error(
          `${workspaceFile.displayName} is not a supported document format.`,
        );
      }

      const storedSource = mergeSpecIntoSource(sourceMarkdown, spec);

      const built = await buildDocument({
        format,
        content: storedSource,
        fileName: workspaceFile.displayName,
        baseSpec: parseStoredSourceSpec(workspaceFile.sourceSpec),
        resolveImage: readWorkspaceImageBytes,
      });

      const file = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!file.exists) {
        file.create({
          intermediates: true,
          overwrite: true,
        });
      }

      file.write(built.bytes);

      await repository.updateMetadata(workspaceFile.id, {
        size: file.size ?? built.bytes.byteLength,
        sourceMarkdown: storedSource,
      });

      await indexDocumentSections(workspaceFile.id, storedSource);

      const nextFile = await repository.getById(workspaceFile.id);

      if (!nextFile) {
        throw new Error("Workspace file metadata is unavailable.");
      }

      return nextFile;
    },
    /**
     * List a document's heading-delimited sections (0-based positions). Lazily
     * indexes the stored source when the snapshot is missing or out of date, so
     * documents created before sectioning still work.
     */
    async listDocumentSections(
      workspaceFile: WorkspaceFile,
    ): Promise<DocumentSection[]> {
      if (!workspaceFile.sourceMarkdown) {
        return [];
      }

      const stored = await repository.listDocumentSections(workspaceFile.id);
      const split = splitDocumentSections(workspaceFile.sourceMarkdown);
      const inSync =
        stored.length === split.sections.length &&
        stored.every(
          (section, index) => section.body === split.sections[index]!.body,
        );

      if (inSync) {
        return stored;
      }

      await indexDocumentSections(workspaceFile.id, workspaceFile.sourceMarkdown);

      return repository.listDocumentSections(workspaceFile.id);
    },
    /** Read one section of a document by its 0-based position. */
    async readDocumentSection(
      workspaceFile: WorkspaceFile,
      position: number,
    ): Promise<DocumentSection> {
      const sections = await this.listDocumentSections(workspaceFile);
      const section = sections[position];

      if (!section) {
        throw new Error(
          `${workspaceFile.displayName} has no section at index ${position} (it has ${sections.length} section(s)).`,
        );
      }

      return section;
    },
    /**
     * Update a document piecewise: replace, insert, append or delete a single
     * heading-delimited section, then regenerate the document from the
     * reassembled source. Only the edited section is provided by the caller.
     */
    async updateDocumentSection(
      workspaceFile: WorkspaceFile,
      input: {
        mode?: "replace" | "insertBefore" | "insertAfter" | "append" | "delete";
        section?: number;
        content?: string;
        spec?: Record<string, unknown>;
      },
    ) {
      if (!workspaceFile.sourceMarkdown) {
        throw new Error(
          `${workspaceFile.displayName} has no stored source; imported documents cannot be edited piecewise. Use updateDocument with the full new content instead.`,
        );
      }

      const split = splitDocumentSections(workspaceFile.sourceMarkdown);
      const sections = [...split.sections];
      const mode = input.mode ?? "replace";
      const index = input.section;

      const requireIndex = () => {
        if (index === undefined) {
          throw new Error(`A section index is required for ${mode}.`);
        }

        if (index < 0 || index >= sections.length) {
          throw new Error(
            `Section index ${index} is out of range (the document has ${sections.length} section(s)).`,
          );
        }
      };

      switch (mode) {
        case "replace":
          requireIndex();
          sections[index!] = parseSectionContent(input.content ?? "");
          break;
        case "insertBefore":
          requireIndex();
          sections.splice(index!, 0, parseSectionContent(input.content ?? ""));
          break;
        case "insertAfter":
          requireIndex();
          sections.splice(index! + 1, 0, parseSectionContent(input.content ?? ""));
          break;
        case "append":
          sections.push(parseSectionContent(input.content ?? ""));
          break;
        case "delete":
          requireIndex();
          sections.splice(index!, 1);
          break;
      }

      const nextSource = assembleDocumentSections({
        prefix: split.prefix,
        sections,
      });

      const nextFile = await this.updateDocumentFile(
        workspaceFile,
        nextSource,
        input.spec,
      );

      return {
        file: nextFile,
        sections: await repository.listDocumentSections(workspaceFile.id),
      };
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
    async downloadFile(input: {
      folderSegments?: string[];
      headers?: Record<string, string>;
      name?: string;
      onProgress?: (progress: {
        bytesWritten: number;
        totalBytes: number;
      }) => void;
      url: string;
    }) {
      const displayName = sanitizeFileName(
        input.name?.trim() ||
          inferFileNameFromUrl(input.url) ||
          "downloaded-file",
      );
      const id = Crypto.randomUUID();
      const relativePath = buildManagedRelativePath({
        folderSegments: input.folderSegments,
        id,
        name: displayName,
      });

      await ensureWorkspaceDirectory();

      const expectedBytes = await resolveExpectedContentLength(
        input.url,
        input.headers,
      );

      if (
        expectedBytes !== null &&
        expectedBytes > Paths.availableDiskSpace
      ) {
        throw new Error(
          `Not enough free space to download ${displayName}: ${expectedBytes} bytes required but only ${Paths.availableDiskSpace} bytes available.`,
        );
      }

      const destinationFile = resolveWorkspaceFile(relativePath);

      await File.downloadFileAsync(input.url, destinationFile, {
        headers: input.headers,
        idempotent: true,
        onProgress: input.onProgress,
      });

      return repository.create({
        id,
        displayName,
        mimeType: destinationFile.type || null,
        originalName: displayName,
        relativePath,
        size: destinationFile.size ?? null,
        sourceKind: "created",
      });
    },
  };
}
