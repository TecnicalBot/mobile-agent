import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { BuiltInToolKey, SkillConfig } from "@/core/types/app-state";

export type ParsedSkillMarkdown = {
  autoMatch: boolean;
  description: string | null;
  instructions: string;
  matchKeywords: string[];
  name: string;
  recommendedBuiltInToolKeys: BuiltInToolKey[];
  recommendedMcpServerIds: string[];
  slug: string;
  sourceMarkdown: string;
  title: string;
};

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 1024;

const TOOL_ALIAS_TO_BUILT_IN_KEY: Record<string, BuiltInToolKey> = {
  askquestion: "question",
  askuserquestion: "question",
  create: "workspaceCreateFile",
  createfile: "workspaceCreateFile",
  edit: "workspaceEdit",
  glob: "workspaceGlob",
  grep: "workspaceGrep",
  list: "workspaceListFiles",
  listfiles: "workspaceListFiles",
  loadskill: "skill",
  read: "workspaceRead",
  search: "workspaceGrep",
  searchtext: "workspaceGrep",
  skill: "skill",
  todos: "todos",
  todowrite: "todos",
  updatetodos: "todos",
  write: "workspaceWrite",
};

const BUILT_IN_TOOL_KEY_TO_SKILL_NAME: Partial<
  Record<BuiltInToolKey, string>
> = {
  question: "AskUserQuestion",
  skill: "Skill",
  todos: "TodoWrite",
  workspaceCreateFile: "Create",
  workspaceEdit: "Edit",
  workspaceGlob: "Glob",
  workspaceGrep: "Grep",
  workspaceListFiles: "List",
  workspaceRead: "Read",
  workspaceWrite: "Write",
};

export function slugifySkillName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function skillSlugMatches(skill: SkillConfig, slug: string) {
  const normalized = slugifySkillName(slug);

  if (!normalized) {
    return false;
  }

  if (slugifySkillName(skill.title) === normalized) {
    return true;
  }

  return skill.title.trim().toLowerCase() === normalized;
}

export function normalizeSkillSlug(value: string) {
  const slug = slugifySkillName(value);

  return NAME_PATTERN.test(slug) ? slug : "skill";
}

function extractFrontmatter(markdown: string) {
  const trimmed = markdown.replace(/^\uFEFF/, "").trimStart();
  const withoutBom = trimmed.startsWith("---") ? trimmed : markdown;

  if (!withoutBom.startsWith("---")) {
    return null;
  }

  const newlineIndex = withoutBom.indexOf("\n");

  if (newlineIndex === -1) {
    return null;
  }

  const closingMatch = /^---[ \t]*\r?\n/gm.exec(
    withoutBom.slice(newlineIndex + 1),
  );

  if (!closingMatch) {
    return null;
  }

  const contentStart = withoutBom.slice(newlineIndex + 1);
  const closingIndex = (closingMatch.index ?? 0) + 1;
  const frontmatter = contentStart.slice(0, closingIndex - 1);
  const body = contentStart.slice(closingMatch.index + closingMatch[0].length);

  return { body, frontmatter };
}

function normalizeList(value: unknown): string[] {
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  return [];
}

function mapAllowedTools(value: unknown): BuiltInToolKey[] {
  return Array.from(
    new Set(
      normalizeList(value)
        .map((name) => TOOL_ALIAS_TO_BUILT_IN_KEY[name.toLowerCase()])
        .filter((key): key is BuiltInToolKey => Boolean(key)),
    ),
  );
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "yes", "on", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "off", "0"].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  const sourceMarkdown = markdown.trim();
  const extracted = extractFrontmatter(sourceMarkdown);

  if (!extracted) {
    throw new Error(
      "This file is not a SKILL.md. Expected YAML frontmatter between '---' markers at the top.",
    );
  }

  let frontmatter: Record<string, unknown>;

  try {
    const parsed = parseYaml(extracted.frontmatter);

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Frontmatter must be a YAML map.");
    }

    frontmatter = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `The frontmatter could not be parsed as YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const rawName =
    typeof frontmatter.name === "string"
      ? frontmatter.name.trim()
      : typeof frontmatter.title === "string"
        ? frontmatter.title.trim()
        : "";
  const title = rawName || "Untitled skill";
  const slug = slugifySkillName(title);
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim() || null
      : null;
  const instructions = extracted.body.trim();
  const disableModelInvocation = parseBoolean(
    frontmatter["disable-model-invocation"],
  );
  const keywords = Array.from(
    new Set([
      ...normalizeList(frontmatter.keywords),
      ...normalizeList(frontmatter.when_to_use),
      ...normalizeList(frontmatter.trigger),
    ]),
  );

  if (!instructions) {
    throw new Error("The SKILL.md body is empty. Add instructions after the frontmatter.");
  }

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `The skill description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  return {
    autoMatch: disableModelInvocation === undefined ? true : !disableModelInvocation,
    description,
    instructions,
    matchKeywords: keywords,
    name: rawName,
    recommendedBuiltInToolKeys: mapAllowedTools(frontmatter["allowed-tools"]),
    recommendedMcpServerIds: normalizeList(
      frontmatter["recommended-mcp-servers"],
    ),
    slug,
    sourceMarkdown,
    title,
  };
}

export function serializeSkillToMarkdown(
  skill: Pick<
    SkillConfig,
    | "autoMatch"
    | "description"
    | "instructions"
    | "matchKeywords"
    | "recommendedBuiltInToolKeys"
    | "recommendedMcpServerIds"
    | "title"
  >,
) {
  const frontmatter: Record<string, unknown> = {
    name: slugifySkillName(skill.title) || "untitled-skill",
    description: skill.description?.trim() ?? skill.title,
  };

  if (skill.matchKeywords.length > 0) {
    frontmatter.keywords = skill.matchKeywords;
  }

  if (skill.recommendedMcpServerIds.length > 0) {
    frontmatter["recommended-mcp-servers"] = skill.recommendedMcpServerIds;
  }

  if (skill.recommendedBuiltInToolKeys.length > 0) {
    const allowedTools = skill.recommendedBuiltInToolKeys
      .map((key) => BUILT_IN_TOOL_KEY_TO_SKILL_NAME[key])
      .filter((name): name is string => Boolean(name));

    if (allowedTools.length > 0) {
      frontmatter["allowed-tools"] = allowedTools;
    }
  }

  if (!skill.autoMatch) {
    frontmatter["disable-model-invocation"] = true;
  }

  const body = skill.instructions.trim();

  if (!body) {
    throw new Error("Skill instructions cannot be empty.");
  }

  return [
    "---",
    stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    body,
    "",
  ].join("\n");
}
