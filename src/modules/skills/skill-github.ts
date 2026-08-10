import { fetchWithTimeout } from "@/core/fetch-with-timeout";

const SKILL_FETCH_TIMEOUT_MS = 15_000;
const SKILL_MAX_BYTES = 200_000;

const SKILL_FETCH_HEADERS = {
  Accept: "text/plain,text/markdown,*/*",
  "User-Agent": "mobile-agent-skill-importer",
};

export function githubBlobToRaw(url: string) {
  const match = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(
    url,
  );

  if (!match) {
    return null;
  }

  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}`;
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

  return githubBlobToRaw(trimmed) ?? trimmed;
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
