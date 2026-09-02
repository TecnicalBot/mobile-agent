import { githubBlobToRaw } from "@/modules/skills/skill-github";
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
}): Promise<SkillAttachment[]> {
  const {
    sourceUrl,
    referencedPaths = [],
    extraFiles = [],
  } = opts;

  if (referencedPaths.length === 0 && extraFiles.length === 0) {
    return [];
  }

  const context = await resolveGithubContext(sourceUrl);

  if (!context) {
    return fetchRelativeReferences(sourceUrl, [
      ...referencedPaths,
      ...extraFiles,
    ]);
  }

  const { owner, repo, branch, dirPath } = context;
  const discovered = await listSkillDirectory({ owner, repo, branch, dirPath });

  const targetPaths = new Set<string>();
  for (const path of discovered) {
    if (path === "SKILL.md" || path.toLowerCase() === "skill.md") {
      continue;
    }
    targetPaths.add(path);
  }
  for (const ref of referencedPaths) {
    targetPaths.add(ref);
  }

  const fetched = new Map<string, SkillAttachment>();
  let totalBytes = 0;

  const ingest = (attachment: SkillAttachment) => {
    const size = attachment.size ?? 0;

    if (fetched.has(attachment.path)) {
      return;
    }

    if (totalBytes + size > SKILL_FILE_MAX_TOTAL_BYTES) {
      return false;
    }

    fetched.set(attachment.path, attachment);
    totalBytes += size;
    return true;
  };

  for (const path of Array.from(targetPaths)) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      break;
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    const attachment = await fetchSingleFile(path, rawUrl);

    if (attachment) {
      ingest(attachment);
    }
  }

  for (const fileUrl of extraFiles) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      break;
    }

    const raw = githubBlobToRaw(fileUrl) ?? fileUrl;
    const path = derivePathFromRaw(raw, owner, repo, branch);
    const attachment = await fetchSingleFile(path, raw);

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
  const rawUrl = githubBlobToRaw(sourceUrl) ?? sourceUrl;
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/i.exec(
    rawUrl,
  );

  if (!match) {
    return null;
  }

  const [, owner, repo, branch, path] = match;
  const dirPath = path
    .replace(/\/?SKILL\.md$/i, "")
    .replace(/\/+$/, "");

  return { owner, repo, branch, dirPath };
}

async function listSkillDirectory(opts: {
  owner: string;
  repo: string;
  branch: string;
  dirPath: string;
}): Promise<string[]> {
  const { owner, repo, branch, dirPath } = opts;
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
        { headers: API_HEADERS },
        SKILL_FILE_FETCH_TIMEOUT_MS,
      );

      if (!response.ok) {
        return results;
      }

      entries = (await response.json()) as GitHubEntry[];
    } catch {
      return results;
    }

    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (entry.type === "dir") {
        queue.push(entry.path);
      } else if (entry.type === "file") {
        results.push(entry.path);
      }
    }
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
): Promise<SkillAttachment[]> {
  const rawUrl = githubBlobToRaw(sourceUrl) ?? sourceUrl;
  const base = rawUrl.replace(/\/?[^/]*\.md$/i, "") || rawUrl;
  const fetched = new Map<string, SkillAttachment>();

  for (const path of referencedPaths) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      break;
    }

    const target = /^https?:\/\//i.test(path) ? path : new URL(path, `${base}/`).href;
    const storedPath = /^https?:\/\//i.test(path)
      ? derivePathFromArbitraryUrl(path)
      : path;
    const attachment = await fetchSingleFile(storedPath, target);

    if (attachment) {
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

async function fetchSingleFile(path: string, rawUrl: string): Promise<SkillAttachment | null> {
  let response: Response;

  try {
    response = await fetchWithTimeout(rawUrl, { headers: FILE_HEADERS }, SKILL_FILE_FETCH_TIMEOUT_MS);
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? null;
  const body = new Uint8Array(await response.arrayBuffer());

  return attachmentFromBytes({ path, bytes: body, mimeType: contentType });
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
