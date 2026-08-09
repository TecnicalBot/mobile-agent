import { fetchWithTimeout } from "@/core/fetch-with-timeout";

export type ResolvedSkillSource =
  | { content: string; displayName: string; kind: "inline" }
  | { displayName: string; kind: "url"; url: string };

const SKILL_FETCH_TIMEOUT_MS = 15_000;
const SKILL_MAX_BYTES = 200_000;

function stripNpxFlags(command: string) {
  return command
    .split(/\s+/)
    .filter(
      (token) => token.length > 0 && !token.startsWith("-") && !/^npx$/i.test(token) && !/^skills$/i.test(token) && !/^add$/i.test(token),
    )
    .join(" ");
}

function githubBlobToRaw(url: string) {
  const match = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(url);

  if (!match) {
    return null;
  }

  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}`;
}

function extractNpxPackage(input: string) {
  const npxMatch = /npx\s+skills\s+add\b/i.exec(input);

  if (!npxMatch) {
    return null;
  }

  const token = stripNpxFlags(input.slice(npxMatch.index));

  if (!token) {
    return null;
  }

  if (/^https?:\/\//i.test(token)) {
    return token;
  }

  if (/^[\w.-]+\/[\w.-]+(@[\w.-]+)?$/.test(token)) {
    return token;
  }

  return null;
}

function packageRefToRawUrl(packageRef: string) {
  const cleaned = packageRef.replace(/^git\+/, "").trim();

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  const [repoPart, skillName] = cleaned.split("@", 2);

  if (!repoPart || !/^[\w.-]+\/[\w.-]+$/.test(repoPart)) {
    return null;
  }

  if (skillName) {
    return `https://raw.githubusercontent.com/${repoPart}/{branch}/${skillName}/SKILL.md`;
  }

  return `https://raw.githubusercontent.com/${repoPart}/{branch}/SKILL.md`;
}

export function resolveSkillSource(input: string): ResolvedSkillSource {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a URL, an npx command, or paste SKILL.md content.");
  }

  const npxPackage = extractNpxPackage(trimmed);

  if (npxPackage) {
    const url = packageRefToRawUrl(npxPackage);

    if (url) {
      return { displayName: npxPackage.split("@")[0], kind: "url", url };
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const rawUrl = githubBlobToRaw(trimmed) ?? trimmed;

    return {
      displayName: rawUrl.split("/").pop() ?? "skill.md",
      kind: "url",
      url: rawUrl,
    };
  }

  if (trimmed.startsWith("---")) {
    const displayNameMatch = /^name:\s*(.+)$/m.exec(trimmed);
    const displayName = displayNameMatch?.[1]?.trim() ?? "skill.md";

    return {
      content: trimmed,
      displayName: `${displayName}.md`,
      kind: "inline",
    };
  }

  throw new Error(
    "Could not recognize this input. Use a URL, an 'npx skills add owner/repo@skill' command, or paste the SKILL.md content directly.",
  );
}

export async function fetchSkillMarkdown(source: ResolvedSkillSource): Promise<{
  content: string;
  displayName: string;
}> {
  if (source.kind === "inline") {
    return { content: source.content, displayName: source.displayName };
  }

  const candidates = source.url.includes("{branch}")
    ? [source.url.replace("{branch}", "main"), source.url.replace("{branch}", "master")]
    : [source.url];
  let lastError: unknown;

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: "text/plain,text/markdown,*/*",
            "User-Agent": "mobile-agent-skill-importer",
          },
        },
        SKILL_FETCH_TIMEOUT_MS,
      );

      if (response.status === 404 || response.status === 410) {
        lastError = new Error(`Skill not found at ${url}.`);
        continue;
      }

      if (!response.ok) {
        lastError = new Error(
          `Could not download the skill (HTTP ${response.status}).`,
        );
        continue;
      }

      const content = await response.text();

      if (content.length > SKILL_MAX_BYTES) {
        throw new Error("The skill file is too large to import.");
      }

      return { content, displayName: source.displayName };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not download the skill.");
}
