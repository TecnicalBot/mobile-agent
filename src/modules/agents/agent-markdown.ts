import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { AgentToolPermissions } from "@/core/types/app-state";
import { TOOL_ALIAS_TO_BUILT_IN_KEY } from "@/modules/skills/skill-markdown";

export type ParsedAgentMarkdown = {
  description: string | null;
  mode: "all" | "primary" | "subagent";
  modelModelId: string | null;
  modelProviderId: string | null;
  name: string;
  prompt: string | null;
  slug: string;
  sourceMarkdown: string;
  temperature: number | null;
  toolPermissions: AgentToolPermissions;
};

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 1024;
const MODES = new Set(["all", "primary", "subagent"]);
export const MCP_TOOL_PREFIX = "mcp:";

export function slugifyAgentName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeAgentSlug(value: string) {
  const slug = slugifyAgentName(value);

  return NAME_PATTERN.test(slug) ? slug : "agent";
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

function parseMode(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  return MODES.has(normalized)
    ? (normalized as ParsedAgentMarkdown["mode"])
    : undefined;
}

function parseTemperature(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(value, 0), 2);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);

    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, 0), 2);
    }
  }

  return null;
}

function parseModelRef(value: unknown): {
  modelId: string | null;
  providerId: string | null;
} {
  if (typeof value !== "string") {
    return { modelId: null, providerId: null };
  }

  const separatorIndex = value.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return { modelId: null, providerId: null };
  }

  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function mapTools(value: unknown): AgentToolPermissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const builtInTools: NonNullable<AgentToolPermissions["builtInTools"]> = {};
  const mcpServers: NonNullable<AgentToolPermissions["mcpServers"]> = {};

  for (const [rawName, rawEnabled] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof rawEnabled !== "boolean") {
      continue;
    }

    const lowerName = rawName.toLowerCase().replace(/\s+/g, "-");

    if (lowerName.startsWith(MCP_TOOL_PREFIX)) {
      const serverId = rawName.trim().slice(MCP_TOOL_PREFIX.length);

      if (serverId) {
        mcpServers[serverId] = rawEnabled;
      }
      continue;
    }

    const key =
      TOOL_ALIAS_TO_BUILT_IN_KEY[lowerName] ??
      TOOL_ALIAS_TO_BUILT_IN_KEY[lowerName.replace(/-/g, "")];

    if (key) {
      builtInTools[key] = rawEnabled;
    }
  }

  return {
    ...(Object.keys(builtInTools).length > 0 ? { builtInTools } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
  };
}

export function parseAgentMarkdown(markdown: string): ParsedAgentMarkdown {
  const sourceMarkdown = markdown.trim();
  const extracted = extractFrontmatter(sourceMarkdown);

  if (!extracted) {
    throw new Error(
      "This file is not an AGENT.md. Expected YAML frontmatter between '---' markers at the top.",
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

  const name =
    typeof frontmatter.name === "string"
      ? frontmatter.name.trim()
      : typeof frontmatter.title === "string"
        ? frontmatter.title.trim()
        : "";
  const slug = normalizeAgentName(name);
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim() || null
      : null;
  const prompt = extracted.body.trim() || null;

  if (!name) {
    throw new Error("The AGENT.md frontmatter must include a 'name'.");
  }

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `The agent description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  const model = parseModelRef(frontmatter.model);

  return {
    description,
    mode: parseMode(frontmatter.mode) ?? "all",
    modelModelId: model.modelId,
    modelProviderId: model.providerId,
    name,
    prompt,
    slug,
    sourceMarkdown,
    temperature: parseTemperature(frontmatter.temperature),
    toolPermissions: mapTools(frontmatter.tools),
  };
}

function serializeToolPermissions(toolPermissions: AgentToolPermissions) {
  const tools: Record<string, boolean> = {};

  for (const [key, enabled] of Object.entries(
    toolPermissions.builtInTools ?? {},
  )) {
    tools[slugifyAgentName(key) || key] = enabled;
  }

  for (const [serverId, enabled] of Object.entries(
    toolPermissions.mcpServers ?? {},
  )) {
    tools[`${MCP_TOOL_PREFIX}${serverId}`] = enabled;
  }

  return Object.keys(tools).length > 0 ? tools : null;
}

export function serializeAgentToMarkdown(
  agent: Pick<
    ParsedAgentMarkdown,
    | "description"
    | "mode"
    | "modelModelId"
    | "modelProviderId"
    | "name"
    | "prompt"
    | "temperature"
    | "toolPermissions"
  >,
) {
  const name = slugifyAgentName(agent.name) || "agent";
  const frontmatter: Record<string, unknown> = {
    name,
    ...(agent.description?.trim()
      ? { description: agent.description.trim() }
      : {}),
    mode: agent.mode,
  };

  if (agent.modelProviderId && agent.modelModelId) {
    frontmatter.model = `${agent.modelProviderId}/${agent.modelModelId}`;
  }

  if (agent.temperature !== null && agent.temperature !== undefined) {
    frontmatter.temperature = agent.temperature;
  }

  const tools = serializeToolPermissions(agent.toolPermissions);

  if (tools) {
    frontmatter.tools = tools;
  }

  const prompt = agent.prompt?.trim() ?? "";

  if (!prompt) {
    throw new Error("Agent system prompt cannot be empty.");
  }

  return [
    "---",
    stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    prompt,
    "",
  ].join("\n");
}

export function normalizeAgentName(value: string) {
  const slug = slugifyAgentName(value);

  return NAME_PATTERN.test(slug) ? slug : "agent";
}
