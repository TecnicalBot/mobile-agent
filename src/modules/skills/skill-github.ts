import { fetchWithTimeout } from "@/core/fetch-with-timeout";

const SKILL_FETCH_TIMEOUT_MS = 15_000;
const SKILL_MAX_BYTES = 200_000;

const SKILL_FETCH_HEADERS = {
  Accept: "text/plain,text/markdown,*/*",
  "User-Agent": "mobile-agent-skill-importer",
};

export function githubBlobToRaw(url: string) {
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
    let path = blobOrTreeMatch[2];
    if (!path.toLowerCase().endsWith(".md")) {
      path = `${path.replace(/\/+$/, "")}/SKILL.md`;
    }
    return `https://raw.githubusercontent.com/${blobOrTreeMatch[1]}/${path}`;
  }

  const repoMatch = /^https?:\/\/github\.com\/([^/]+\/[^/]+)(?:\/)?$/i.exec(
    cleanUrl,
  );
  if (repoMatch) {
    return `https://raw.githubusercontent.com/${repoMatch[1]}/main/SKILL.md`;
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
  const resolved = resolveSkillMarkdownUrl(input);
  const displayName = resolved.split("/").pop() ?? "skill.md";
  const response = await fetchWithTimeout(
    resolved,
    { headers: SKILL_FETCH_HEADERS },
    SKILL_FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Could not download the skill (HTTP ${response.status}).`);
  }

  const content = await response.text();

  if (content.length > SKILL_MAX_BYTES) {
    throw new Error("The skill file is too large to import.");
  }

  return { content, displayName };
}
