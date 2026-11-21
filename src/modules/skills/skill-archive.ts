import { Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from "fflate";

import { sanitizeRelPath } from "@/modules/content/paths";
import {
  attachmentFromBytes,
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_MAX_COUNT,
  SKILL_FILE_MAX_TOTAL_BYTES,
  type SkillAttachment,
} from "@/modules/skills/skill-files";
import {
  parseSkillMarkdown,
  type ParsedSkillMarkdown,
} from "@/modules/skills/skill-markdown";

export const SKILL_ARCHIVE_MAX_BYTES = 10_000_000;
export const SKILL_ARCHIVE_MAX_TOTAL_BYTES = 20_000_000;
export const SKILL_ARCHIVE_MAX_ENTRIES = 2_500;
export const SKILL_ARCHIVE_MAX_SKILLS = 50;

export type ArchivedSkill = {
  path: string;
  markdown: string | null;
  parsed: ParsedSkillMarkdown | null;
  files: SkillAttachment[];
  error: string | null;
};

type ArchiveEntry = UnzipFileInfo & { path: string; directory: boolean };

function archivePath(name: string) {
  const path = name.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const safe = sanitizeRelPath(trimmed);

  if (!safe || safe !== trimmed || safe.includes(":") || safe.length > 512) {
    throw new Error(`The ZIP contains an unsafe file path: ${name}`);
  }

  return safe;
}

function isMetadata(path: string) {
  return path.split("/").some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"),
  );
}

const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "text/plain",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  jsx: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/x-python",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
};

function looksBinary(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4_096));
  let controlBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    if (byte < 9 || (byte > 13 && byte < 32)) {
      controlBytes += 1;
    }
  }

  return sample.length > 0 && controlBytes > sample.length * 0.1;
}

function mimeTypeForFile(path: string, bytes: Uint8Array) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const known = MIME_TYPES[extension];

  if (known) {
    return known;
  }

  // Unknown binary assets are stored as base64, not lossy UTF-8.
  return looksBinary(bytes) ? "application/octet-stream" : "text/plain";
}

/**
 * Inspect the central directory without inflating anything, then stream only
 * eligible skill files. Checking actual output as well as declared sizes avoids
 * trusting ZIP metadata for the decompression limits. No workers are required.
 */
export async function parseSkillArchive(bytes: Uint8Array): Promise<ArchivedSkill[]> {
  if (bytes.byteLength > SKILL_ARCHIVE_MAX_BYTES) {
    throw new Error("The ZIP is too large. Choose an archive of at most 10 MB.");
  }

  const entries = new Map<string, ArchiveEntry>();
  const paths = new Set<string>();
  let declaredBytes = 0;

  try {
    unzipSync(bytes, {
      filter(info) {
        if (entries.size >= SKILL_ARCHIVE_MAX_ENTRIES) {
          throw new Error(`The ZIP contains too many entries (maximum ${SKILL_ARCHIVE_MAX_ENTRIES}).`);
        }
        const path = archivePath(info.name);
        if (paths.has(path)) {
          throw new Error(`The ZIP contains a duplicate file path: ${path}`);
        }
        paths.add(path);
        declaredBytes += info.originalSize;
        if (!Number.isSafeInteger(declaredBytes) || declaredBytes > SKILL_ARCHIVE_MAX_TOTAL_BYTES) {
          throw new Error("The ZIP expands to more than 20 MB.");
        }
        entries.set(info.name, {
          ...info,
          path,
          directory: /[\\/]$/.test(info.name),
        });
        return false;
      },
    });
  } catch (error) {
    throw new Error(
      `Could not read the ZIP: ${error instanceof Error ? error.message : "invalid archive"}`,
    );
  }

  const documents = [...entries.values()].filter(
    (entry) => !entry.directory && !isMetadata(entry.path) && /(^|\/)SKILL\.md$/i.test(entry.path),
  );
  if (documents.length === 0) {
    throw new Error("No SKILL.md files were found in this ZIP.");
  }
  if (documents.length > SKILL_ARCHIVE_MAX_SKILLS) {
    throw new Error(`The ZIP contains too many skills (maximum ${SKILL_ARCHIVE_MAX_SKILLS}).`);
  }

  // The deepest skill directory owns a file; nested skills never leak into
  // their parent's supporting files, even when the nested skill is invalid.
  const groups = documents.map((document) => ({
    document,
    root: document.path.slice(0, -("SKILL.md".length)),
    entries: [] as ArchiveEntry[],
    error: null as string | null,
  })).sort((a, b) => b.root.length - a.root.length);
  const roots = new Set<string>();
  for (const group of groups) {
    if (roots.has(group.root)) {
      throw new Error(`More than one SKILL.md was found in ${group.root || "the ZIP root"}.`);
    }
    roots.add(group.root);
  }

  for (const entry of entries.values()) {
    if (entry.directory || isMetadata(entry.path)) {
      continue;
    }
    groups.find((group) => entry.path.startsWith(group.root))?.entries.push(entry);
  }

  const wanted = new Set<string>();
  for (const group of groups) {
    const oversized = group.entries.find((entry) => entry.originalSize > SKILL_FILE_MAX_BYTES);
    if (oversized) {
      group.error = `${oversized.path} exceeds the 200 KB per-file limit.`;
    } else if (group.entries.length > SKILL_FILE_MAX_COUNT) {
      group.error = `This skill exceeds the ${SKILL_FILE_MAX_COUNT}-file limit, including SKILL.md.`;
    } else if (group.entries.reduce((sum, entry) => sum + entry.originalSize, 0) > SKILL_FILE_MAX_TOTAL_BYTES) {
      group.error = "This skill exceeds the 1 MB total file limit.";
    } else if (group.entries.some((entry) => entry.compression !== 0 && entry.compression !== 8)) {
      group.error = "This skill uses an unsupported ZIP compression method.";
    } else {
      group.entries.forEach((entry) => wanted.add(entry.name));
    }
  }

  const extracted = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let actualBytes = 0;
  const stream = new Unzip((file) => {
    const entry = entries.get(file.name);
    if (!entry || seen.has(file.name) || entry.compression !== file.compression) {
      throw new Error("The ZIP file headers do not match its directory.");
    }
    seen.add(file.name);
    if (!wanted.has(file.name)) {
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        throw error;
      }
      size += chunk.byteLength;
      actualBytes += chunk.byteLength;
      if (size > SKILL_FILE_MAX_BYTES || size > entry.originalSize || actualBytes > SKILL_ARCHIVE_MAX_TOTAL_BYTES) {
        throw new Error(`The ZIP exceeds its extraction limits at ${entry.path}.`);
      }
      chunks.push(chunk);
      if (final) {
        if (size !== entry.originalSize) {
          throw new Error(`The ZIP contains an incomplete file: ${entry.path}`);
        }
        const output = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          output.set(part, offset);
          offset += part.byteLength;
        }
        extracted.set(file.name, output);
      }
    };
    file.start();
  });
  stream.register(UnzipInflate);

  try {
    // Bounded chunks keep inflate buffers small; yielding periodically stops a
    // large bundle from freezing the mobile UI.
    for (let offset = 0; offset < bytes.length; offset += 8_192) {
      stream.push(
        bytes.subarray(offset, offset + 8_192),
        offset + 8_192 >= bytes.length,
      );
      if (offset > 0 && offset % 65_536 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if ([...wanted].some((name) => !extracted.has(name)) || seen.size !== entries.size) {
      throw new Error("The ZIP is incomplete or its file headers do not match.");
    }
  } catch (error) {
    throw new Error(`Could not extract the ZIP: ${error instanceof Error ? error.message : "invalid archive"}`);
  }

  return groups.map((group): ArchivedSkill => {
    const skill: ArchivedSkill = {
      path: group.document.path,
      markdown: null,
      parsed: null,
      files: [],
      error: group.error,
    };
    if (skill.error) {
      return skill;
    }
    try {
      skill.markdown = new TextDecoder("utf-8").decode(
        extracted.get(group.document.name)!,
      );
      skill.parsed = parseSkillMarkdown(skill.markdown);
      for (const entry of group.entries) {
        const content = extracted.get(entry.name)!;
        const attachment = attachmentFromBytes({
          path: entry === group.document ? "SKILL.md" : entry.path.slice(group.root.length),
          bytes: content,
          mimeType: entry === group.document ? "text/markdown" : mimeTypeForFile(entry.path, content),
        });
        if (!attachment) {
          throw new Error(`Could not read supporting file ${entry.path}.`);
        }
        skill.files.push(attachment);
      }
    } catch (error) {
      skill.error = error instanceof Error ? error.message : "Invalid SKILL.md.";
      skill.files = [];
    }
    return skill;
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
