import { githubBlobToRaw } from "@/modules/skills/skill-github";
import { fetchWithTimeout } from "@/core/fetch-with-timeout";

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
  referencedPaths: string[];
}): Promise<SkillAttachment[]> {
  const { sourceUrl, referencedPaths } = opts;

  if (referencedPaths.length === 0) {
    return [];
  }

  const context = await resolveGithubContext(sourceUrl);

  if (!context) {
    return fetchRelativeReferences(sourceUrl, referencedPaths);
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

  for (const path of Array.from(targetPaths)) {
    if (fetched.size >= SKILL_FILE_MAX_COUNT) {
      break;
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    const attachment = await fetchSingleFile(path, rawUrl);

    if (attachment) {
      const size = attachment.size ?? 0;

      if (totalBytes + size > SKILL_FILE_MAX_TOTAL_BYTES) {
        break;
      }

      fetched.set(path, attachment);
      totalBytes += size;
    }
  }

  return Array.from(fetched.values());
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
    const attachment = await fetchSingleFile(path, target);

    if (attachment) {
      fetched.set(path, attachment);
    }
  }

  return Array.from(fetched.values());
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
  const size = body.byteLength;

  if (size > SKILL_FILE_MAX_BYTES) {
    return null;
  }

  const isBinary = !/^text\/|javascript|json|xml|yaml|yml|markdown|md|csv|toml|sh|zsh|bash|python|x-/i.test(
    contentType ?? "",
  );

  let content: string;

  if (isBinary) {
    content = bytesToBase64(body);
  } else {
    try {
      content = new TextDecoder().decode(body);
    } catch {
      return null;
    }
  }

  return { path, content, mimeType: contentType, size };
}

function bytesToBase64(bytes: Uint8Array) {
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
