import { fetchWithTimeout } from "@/core/fetch-with-timeout";

const SKILL_FETCH_TIMEOUT_MS = 15_000;
const SKILL_MAX_BYTES = 200_000;

const SKILL_FETCH_HEADERS = {
  Accept: "text/plain,text/markdown,*/*",
  "User-Agent": "mobile-agent-skill-importer",
};

const API_FETCH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "mobile-agent-skill-importer",
};

const BRANCH_PLACEHOLDER = "__DEFAULT_BRANCH__";
const branchCache = new Map<string, string>();

export function githubBlobToRaw(url: string): string | null {
  const cleanUrl = url.split(/[?#]/)[0] ?? url;

  const gistMatch = /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)(?:\/raw)?(?:\/.*)?$/i.exec(
    cleanUrl,
  );
  if (gistMatch) {
    return `https://gist.githubusercontent.com/${gistMatch[1]}/${gistMatch[2]}/raw`;
  }

  const rawMatch = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/(.+)$/i.exec(
    cleanUrl,
  );
  if (rawMatch) {
    return `https://raw.githubusercontent.com/${rawMatch[1]}/${rawMatch[2]}`;
  }

  const blobOrTreeMatch = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\/(.+)$/i.exec(
    cleanUrl,
  );
  if (blobOrTreeMatch) {
    const repo = blobOrTreeMatch[1];
    const rawPath = (blobOrTreeMatch[2] ?? "").replace(/\/+$/, "");
    const slashIndex = rawPath.indexOf("/");
    const branch = slashIndex === -1 ? rawPath : rawPath.slice(0, slashIndex);
    const path = slashIndex === -1 ? "" : rawPath.slice(slashIndex + 1);

    if (path && path.toLowerCase().endsWith(".md")) {
      return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
    }

    const skillPath = path ? `${path}/SKILL.md` : "SKILL.md";
    return `https://raw.githubusercontent.com/${repo}/${branch}/${skillPath}`;
  }

  const repoMatch = /^https?:\/\/github\.com\/([^/]+\/[^/]+)(?:\/)?$/i.exec(
    cleanUrl,
  );
  if (repoMatch) {
    return `https://raw.githubusercontent.com/${repoMatch[1]}/${BRANCH_PLACEHOLDER}/SKILL.md`;
  }

  return null;
}

export function resolveSkillMarkdownUrl(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a URL to a SKILL.md file.");
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      "Enter a valid http(s) URL ending in SKILL.md or another markdown file.",
    );
  }

  return githubBlobToRaw(trimmed) ?? trimmed.split(/[?#]/)[0]!;
}

export async function fetchSkillMarkdownFromUrl(input: string): Promise<{
  content: string;
  displayName: string;
}> {
  const resolved = await resolveRawUrlWithDefaultBranch(input);
  const displayName = resolved.split("/").pop() ?? "skill.md";
  const response = await fetchWithTimeout(
    resolved,
    { headers: SKILL_FETCH_HEADERS },
    SKILL_FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(describeHttpFailure(response.status));
  }

  const contentType = response.headers.get("content-type") ?? "";
  const content = await response.text();

  if (content.length > SKILL_MAX_BYTES) {
    throw new Error("The skill file is too large to import.");
  }

  if (isHtmlContent(contentType, content)) {
    throw new Error(
      "That URL did not return a markdown file (it returned an HTML page instead). Use the raw SKILL.md file URL, e.g. https://raw.githubusercontent.com/owner/repo/branch/path/SKILL.md",
    );
  }

  return { content, displayName };
}

async function resolveRawUrlWithDefaultBranch(input: string) {
  const resolved = resolveSkillMarkdownUrl(input);

  if (!resolved.includes(BRANCH_PLACEHOLDER)) {
    return resolved;
  }

  const repo = extractRepoFromRawUrl(resolved);
  if (!repo) {
    return resolved.replace(BRANCH_PLACEHOLDER, "main");
  }

  const branch = await resolveDefaultBranch(repo);
  return resolved.replace(BRANCH_PLACEHOLDER, branch);
}

function extractRepoFromRawUrl(url: string) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[^/]+\//.exec(
    url,
  );

  return match ? match[1] : null;
}

export async function resolveDefaultBranch(repo: string): Promise<string> {
  const existing = branchCache.get(repo);
  if (existing) {
    return existing;
  }

  const { owner, name } = parseRepo(repo);

  if (!owner || !name) {
    return "main";
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${name}`,
      { headers: API_FETCH_HEADERS },
      SKILL_FETCH_TIMEOUT_MS,
    );

    if (response.ok) {
      const data = (await response.json()) as { default_branch?: string };
      const branch = data.default_branch?.trim();
      if (branch) {
        branchCache.set(repo, branch);
        return branch;
      }
    }
  } catch {
    // fall through to main -> master fallback below
  }

  for (const candidate of ["main", "master"]) {
    const ok = await branchExists(repo, candidate);
    if (ok) {
      branchCache.set(repo, candidate);
      return candidate;
    }
  }

  return "main";
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  const { owner, name } = parseRepo(repo);

  if (!owner || !name) {
    return false;
  }

  try {
    const response = await fetchWithTimeout(
      `https://raw.githubusercontent.com/${owner}/${name}/${branch}/SKILL.md`,
      { headers: SKILL_FETCH_HEADERS, method: "HEAD" },
      SKILL_FETCH_TIMEOUT_MS,
    );

    return response.ok;
  } catch {
    return false;
  }
}

function parseRepo(repo: string) {
  const match = /^([^/]+)\/([^/]+)$/.exec(repo.replace(/\/+$/, ""));

  if (!match) {
    return { owner: null, name: null };
  }

  return { owner: match[1], name: match[2] };
}

function describeHttpFailure(status: number) {
  if (status === 403 || status === 429) {
    return `Could not download the skill (HTTP ${status}). This is often a GitHub rate limit or request rejection. Try again later or use a direct raw.githubusercontent.com URL.`;
  }

  return `Could not download the skill (HTTP ${status}).`;
}

function isHtmlContent(contentType: string, content: string) {
  if (/text\/html/i.test(contentType)) {
    return true;
  }

  return /^\s*(<!doctype html|<html|<!DOCTYPE html)/i.test(content);
}

export function resetBranchCacheForTests() {
  branchCache.clear();
}

export function __getBranchCacheSizeForTests() {
  return branchCache.size;
}
