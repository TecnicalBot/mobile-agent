import { Directory, File, Paths } from "expo-file-system";

export { sanitizeFileName, sanitizeRelPath } from "@/modules/content/paths";

/**
 * File-system storage for skills and agents, mirroring the plugin files
 * pattern (see `src/modules/plugins/plugin-files.ts`).
 *
 * Layout:
 *   <document>/mobile-agent/skills/<id>/SKILL.md
 *   <document>/mobile-agent/skills/<id>/files/<path>     (supporting files)
 *   <document>/mobile-agent/skills/<id>/files.json        (supporting file metadata)
 *   <document>/mobile-agent/agents/<id>/AGENT.md
 *   <document>/mobile-agent/agents/<id>/docs/<name>       (agent reference docs)
 *   <document>/mobile-agent/agents/<id>/docs.json         (doc metadata)
 *
 * The markdown file is the single source of truth for content; the SQLite row
 * keeps only the id, the file path pointer and runtime toggles.
 */

export type ContentKind = "skills" | "agents";

export const SKILLS_DIR_NAME = "skills";
export const AGENTS_DIR_NAME = "agents";

export const SKILL_MARKDOWN_FILE = "SKILL.md";
export const AGENT_MARKDOWN_FILE = "AGENT.md";
export const SKILL_FILES_DIR = "files";
export const AGENT_DOCS_DIR = "docs";
export const SKILL_FILES_MANIFEST_FILE = "files.json";
export const AGENT_DOCS_MANIFEST_FILE = "docs.json";

const CONTENT_ROOT = new Directory(Paths.document, "mobile-agent");

export function ensureContentDir() {
  if (!CONTENT_ROOT.exists) {
    CONTENT_ROOT.create({ idempotent: true, intermediates: true });
  }
}

export function contentRoot(): Directory {
  ensureContentDir();
  return CONTENT_ROOT;
}

export function getEntityBaseDir(kind: ContentKind): Directory {
  const base = new Directory(contentRoot(), kind);
  if (!base.exists) {
    base.create({ idempotent: true, intermediates: true });
  }
  return base;
}

export function getEntityDir(kind: ContentKind, id: string): Directory {
  return new Directory(getEntityBaseDir(kind), id);
}

export function ensureEntityDir(kind: ContentKind, id: string): Directory {
  const dir = getEntityDir(kind, id);
  if (!dir.exists) {
    dir.create({ idempotent: true, intermediates: true });
  }
  return dir;
}

export function getEntityFile(
  kind: ContentKind,
  id: string,
  segments: string[],
): File {
  return new File(getEntityDir(kind, id), ...segments);
}

export function writeEntityFile(
  kind: ContentKind,
  id: string,
  segments: string[],
  content: string,
): string {
  const dir = ensureEntityDir(kind, id);
  const file = new File(dir, ...segments);
  file.create({ intermediates: true, overwrite: true });
  file.write(content);
  return file.uri;
}

export async function readEntityFile(
  kind: ContentKind,
  id: string,
  segments: string[],
): Promise<string | null> {
  const dir = getEntityDir(kind, id);
  if (!dir.exists) {
    return null;
  }
  const file = new File(dir, ...segments);
  if (!file.exists) {
    return null;
  }
  return file.text();
}

export function deleteEntityFile(
  kind: ContentKind,
  id: string,
  segments: string[],
): void {
  const dir = getEntityDir(kind, id);
  if (!dir.exists) {
    return;
  }
  const file = new File(dir, ...segments);
  if (file.exists) {
    file.delete();
  }
}

export function deleteEntitySubdir(
  kind: ContentKind,
  id: string,
  name: string,
): void {
  const dir = getEntityDir(kind, id);
  if (!dir.exists) {
    return;
  }
  const sub = new Directory(dir, name);
  if (sub.exists) {
    sub.delete();
  }
}

export function deleteEntityDir(kind: ContentKind, id: string): void {
  const dir = getEntityDir(kind, id);
  if (dir.exists) {
    dir.delete();
  }
}

export function writeJsonAt<T>(value: T, kind: ContentKind, id: string, name: string): void {
  writeEntityFile(kind, id, [name], JSON.stringify(value));
}

export async function readJsonAt<T>(kind: ContentKind, id: string, name: string): Promise<T | null> {
  const raw = await readEntityFile(kind, id, [name]);
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type SkillFileMeta = {
  path: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SkillFilesManifest = {
  version: 1;
  files: SkillFileMeta[];
};

export type AgentDocMeta = {
  file: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AgentDocsManifest = {
  version: 1;
  docs: AgentDocMeta[];
};

export async function readSkillFilesManifest(
  id: string,
): Promise<SkillFilesManifest | null> {
  return readJsonAt<SkillFilesManifest>("skills", id, SKILL_FILES_MANIFEST_FILE);
}

export function writeSkillFilesManifest(
  id: string,
  files: SkillFilesManifest["files"],
): void {
  const manifest: SkillFilesManifest = { version: 1, files };
  writeJsonAt(manifest, "skills", id, SKILL_FILES_MANIFEST_FILE);
}

export async function readAgentDocsManifest(id: string): Promise<AgentDocsManifest | null> {
  return readJsonAt<AgentDocsManifest>("agents", id, AGENT_DOCS_MANIFEST_FILE);
}

export function writeAgentDocsManifest(
  id: string,
  docs: AgentDocsManifest["docs"],
): void {
  const manifest: AgentDocsManifest = { version: 1, docs };
  writeJsonAt(manifest, "agents", id, AGENT_DOCS_MANIFEST_FILE);
}