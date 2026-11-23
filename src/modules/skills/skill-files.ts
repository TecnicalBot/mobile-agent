import {
  githubBlobToRaw,
  resolveRawUrlWithDefaultBranch,
} from "@/modules/skills/skill-github";
import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";

export const SKILL_FILE_FETCH_TIMEOUT_MS = 15_000;
export const SKILL_FILE_MAX_BYTES = 200_000;
export const SKILL_FILE_MAX_TOTAL_BYTES = 1_000_000;
export const SKILL_FILE_MAX_COUNT = 50;

export type SkillAttachment = {
  path: string;
  content: string;
  mimeType: string | null;
  size: number | null;
};

const FILE_HEADERS = {
  Accept: "*/*",
  "User-Agent": "mobile-agent-skill-importer",
};

const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "mobile-agent-skill-importer",
};

type GitHubEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url?: string | null;
};

export async function fetchSkillFiles(opts: {
  sourceUrl: string;
  referencedPaths?: string[];
  extraFiles?: string[];
  strict?: boolean;
}): Promise<SkillAttachment[]> {
  const {
    sourceUrl,
    referencedPaths = [],
    extraFiles = [],
    strict = false,
  } = opts;

  if (referencedPaths.length === 0 && extraFiles.length === 0) {
    return [];
  }

  const context = await resolveGithubContext(sourceUrl);

  if (!context) {
    return fetchRelativeReferences(sourceUrl, [
      ...referencedPaths,
      ...extraFiles,
    ], strict);
  }

  const { owner, repo, branch, dirPath, markdownPath } = context;
  const discovered = await listSkillDirectory({
    owner, repo, branch, dirPath, strict,
  });

  // Keys are repository paths; values are the paths stored with the skill.
  const targetPaths = new Map<string, string>();
  for (const path of discovered) {
    if (path === markdownPath) {
      continue;
    }
    targetPaths.set(path, path);
  }
  for (const ref of referencedPaths) {
    const path = dirPath && !ref.startsWith(`${dirPath}/`)
      ? `${dirPath}/${ref}`
      : ref;
    if (path !== markdownPath && !targetPaths.has(path)) {
      targetPaths.set(path, ref);
    }
  }

  if (strict && targetPaths.size > SKILL_FILE_MAX_COUNT) {
    throw new Error("The skill has too many related files to sync safely.");
  }

  const fetched = new Map<string, SkillAttachment>();
  let totalBytes = 0;

  const ingest = (attachment: SkillAttachment) => {
    const size = attachment.size ?? 0;

    if (fetched.has(attachment.path)) {
      return;
    }

    if (totalBytes + size > SKILL_FILE_MAX_TOTAL_BYTES) {
      if (strict) {
        throw new Error("The skill's related files are too large to sync safely.");
      }
      return false;
    }

    fetched.set(attachment.path, attachment);
    totalBytes += size;
    return true;
  };

  for (const [remotePath, path] of targetPaths) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      break;
    }

    const isDiscovered = discovered.includes(remotePath);
    let attachment = await fetchSingleFile(
      path,
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`,
      strict,
      !isDiscovered,
    );

    // Older imports stored repo-root-relative references. If the scoped path
    // is missing, retry the original path before giving up.
    if (!attachment && !isDiscovered && remotePath !== path) {
      attachment = await fetchSingleFile(
        path,
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
        strict,
      );
    }

    if (attachment) {
      ingest(attachment);
    }
  }

  for (const fileUrl of extraFiles) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      if (strict) {
        throw new Error("The skill has too many related files to sync safely.");
      }
      break;
    }

    const raw = githubBlobToRaw(fileUrl) ?? fileUrl;
    const path = derivePathFromRaw(raw, owner, repo, branch);
    const attachment = await fetchSingleFile(path, raw, strict);

    if (attachment) {
      ingest(attachment);
    }
  }

  return Array.from(fetched.values());
}

function derivePathFromRaw(
  rawUrl: string,
  owner: string,
  repo: string,
  branch: string,
) {
  const match = new RegExp(
    `^https:\/\/raw\.githubusercontent\.com\/${escapeRegex(owner)}\/${escapeRegex(repo)}\/${escapeRegex(branch)}\/(.+)$`,
    "i",
  ).exec(rawUrl);

  if (match) {
    return match[1] as string;
  }

  const stripped = rawUrl.replace(/[?#].*$/, "");
  const basename = stripped.split("/").pop();

  return basename || rawUrl;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveGithubContext(sourceUrl: string) {
  const rawUrl = await resolveRawUrlWithDefaultBranch(sourceUrl);
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/i.exec(
    rawUrl,
  );

  if (!match) {
    return null;
  }

  const [, owner, repo, branch, path] = match;
  const dirPath = path.slice(0, Math.max(0, path.lastIndexOf("/")));

  return { owner, repo, branch, dirPath, markdownPath: path };
}

async function listSkillDirectory(opts: {
  owner: string;
  repo: string;
  branch: string;
  dirPath: string;
  strict: boolean;
}): Promise<string[]> {
  const { owner, repo, branch, dirPath, strict } = opts;
  const results: string[] = [];
  const queue = [dirPath];
  const seen = new Set<string>();

  while (queue.length > 0 && results.length < SKILL_FILE_MAX_COUNT) {
    const current = queue.shift() as string;

    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    let entries: GitHubEntry[];

    try {
      const response = await fetchWithTimeout(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitPath(current)}?ref=${encodeURIComponent(branch)}`,
        { headers: API_HEADERS, cache: "no-store" },
        SKILL_FILE_FETCH_TIMEOUT_MS,
      );

      if (!response.ok) {
        if (strict) {
          throw new Error(`Could not list skill files (HTTP ${response.status}). Try syncing again later.`);
        }
        return results;
      }

      entries = (await response.json()) as GitHubEntry[];
    } catch (error) {
      if (strict) throw error;
      return results;
    }

    if (!Array.isArray(entries)) {
      if (strict) throw new Error("Could not read the skill's file listing.");
      continue;
    }

    for (const entry of entries) {
      if (entry.type === "dir") {
        queue.push(entry.path);
      } else if (entry.type === "file") {
        results.push(entry.path);
        if (strict && results.length > SKILL_FILE_MAX_COUNT) {
          throw new Error("The skill has too many related files to sync safely.");
        }
      }
    }
  }

  if (strict && (queue.length > 0 || results.length > SKILL_FILE_MAX_COUNT)) {
    throw new Error("The skill has too many related files to sync safely.");
  }
  return results;
}

function encodeGitPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function fetchRelativeReferences(
  sourceUrl: string,
  referencedPaths: string[],
  strict: boolean,
): Promise<SkillAttachment[]> {
  const rawUrl = githubBlobToRaw(sourceUrl) ?? sourceUrl;
  const base = rawUrl.replace(/\/?[^/]*\.md$/i, "") || rawUrl;
  const fetched = new Map<string, SkillAttachment>();
  let totalBytes = 0;

  for (const path of referencedPaths) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      if (strict) throw new Error("The skill has too many related files to sync safely.");
      break;
    }

    const target = /^https?:\/\//i.test(path) ? path : new URL(path, `${base}/`).href;
    const storedPath = /^https?:\/\//i.test(path)
      ? derivePathFromArbitraryUrl(path)
      : path;
    const attachment = await fetchSingleFile(storedPath, target, strict);

    if (attachment) {
      totalBytes += attachment.size ?? 0;
      if (totalBytes > SKILL_FILE_MAX_TOTAL_BYTES) {
        if (strict) throw new Error("The skill's related files are too large to sync safely.");
        break;
      }
      fetched.set(storedPath, attachment);
    }
  }

  return Array.from(fetched.values());
}

function derivePathFromArbitraryUrl(url: string) {
  const match = githubBlobToRaw(url);

  if (match) {
    return match.replace(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//, "");
  }

  const stripped = url.replace(/[?#].*$/, "");
  const basename = stripped.split("/").pop();

  return basename || url;
}

async function fetchSingleFile(
  path: string,
  rawUrl: string,
  strict = false,
  allowMissing = false,
): Promise<SkillAttachment | null> {
  let response: Response;

  try {
    response = await fetchWithTimeout(
      rawUrl, { headers: FILE_HEADERS, cache: "no-store" }, SKILL_FILE_FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    if (strict) throw error;
    return null;
  }

  if (!response.ok) {
    if (strict && !(allowMissing && response.status === 404)) {
      throw new Error(`Could not download skill file "${path}" (HTTP ${response.status}).`);
    }
    return null;
  }

  const contentType = response.headers.get("content-type") ?? null;
  const body = new Uint8Array(await response.arrayBuffer());

  const attachment = attachmentFromBytes({ path, bytes: body, mimeType: contentType });
  if (strict && !attachment) {
    throw new Error(`Skill file "${path}" is too large or could not be read.`);
  }
  return attachment;
}

export function isBinaryMimeType(mimeType: string | null) {
  return !/^text\/|javascript|json|xml|yaml|yml|markdown|md|csv|toml|sh|zsh|bash|python|x-/i.test(
    mimeType ?? "",
  );
}

export function attachmentFromBytes(input: {
  path: string;
  bytes: Uint8Array;
  mimeType?: string | null;
}): SkillAttachment | null {
  const size = input.bytes.byteLength;

  if (size > SKILL_FILE_MAX_BYTES) {
    return null;
  }

  const mimeType = input.mimeType ?? null;
  const isBinary = isBinaryMimeType(mimeType);

  let content: string;

  if (isBinary) {
    content = bytesToBase64(input.bytes);
  } else {
    try {
      content = new TextDecoder().decode(input.bytes);
    } catch {
      return null;
    }
  }

  return { path: input.path, content, mimeType, size };
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

export function summarizeSkillFiles(files: SkillAttachment[]) {
  return files.map((file) => ({
    path: file.path,
    size: file.size,
    mimeType: file.mimeType,
  }));
}

export function pickSkillFile(
  files: { name: string; content: string }[],
): string | null {
  const exact = files.find((file) => file.name.toLowerCase() === "skill.md");

  if (exact) {
    return exact.name;
  }

  const parsed = files.find(
    (file) =>
      file.name.toLowerCase().endsWith(".md") &&
      Boolean(parseSkillMarkdown(file.content).title),
  );

  return parsed?.name ?? null;
}
