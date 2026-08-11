import { tool } from "ai";
import { z } from "zod";

import type { SkillRepository } from "@/core/db/repositories/types";
import type {
  BuiltInToolKey,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import {
  parseSkillMarkdown,
  serializeSkillToMarkdown,
  skillSlugMatches,
  slugifySkillName,
} from "@/modules/skills/skill-markdown";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

const MAX_INSTRUCTIONS_LENGTH = 40_000;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_TITLE_LENGTH = 64;
const MAX_KEYWORDS = 20;
const MAX_ALLOWED_TOOLS = 12;

const builtInToolKeysSchema = z
  .array(z.string())
  .max(MAX_ALLOWED_TOOLS)
  .optional();

function normalizeToolKeys(values: string[] | undefined): BuiltInToolKey[] {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(
      values.filter(
        (key): key is BuiltInToolKey =>
          typeof key === "string" && key.length > 0,
      ),
    ),
  );
}

function formatSkillForCatalog(skill: {
  autoMatch: boolean;
  description: string | null;
  title: string;
}) {
  return {
    description: skill.description?.trim() || null,
    matchDescription: skill.autoMatch,
    name: skill.title,
  };
}

export function createSkillTools(input: {
  onRecord?: (record: ToolExecutionRecord) => void;
  onSkillsChange?: () => void;
  repository: SkillRepository;
}) {
  const { onRecord, onSkillsChange, repository } = input;

  const findSkillBySlug = async (name: string) => {
    const skills = await repository.list();

    return (
      skills.find((skill) => skillSlugMatches(skill, name)) ??
      skills.find(
        (skill) => skill.title.toLowerCase() === name.toLowerCase(),
      ) ??
      null
    );
  };

  return {
    tools: {
      skill: tool({
        description:
          "Load the full instructions of a skill by its name. Use when the current task matches a skill from the available skills list or the user mentions one. Returns the complete skill instructions and its recommended tools.",
        inputSchema: z.object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(MAX_TITLE_LENGTH)
            .describe("The skill name to load."),
        }),
        execute: async ({ name }) => {
          const skill = await findSkillBySlug(name);

          if (!skill) {
            return {
              found: false,
              message: `No skill named "${name}" exists. Check the available skills list or suggest creating it.`,
            };
          }

          onRecord?.(
            createRecord({
              toolName: "skill",
              status: "completed",
              inputSummary: summarizeValue({ name: skill.title }),
              outputSummary: summarizeValue({
                chars: skill.instructions.length,
                title: skill.title,
              }),
            }),
          );

          return {
            found: true,
            name: skill.title,
            description: skill.description?.trim() ?? null,
            autoMatch: skill.autoMatch,
            matchKeywords: skill.matchKeywords,
            recommendedBuiltInToolKeys: skill.recommendedBuiltInToolKeys,
            recommendedMcpServerIds: skill.recommendedMcpServerIds,
            instructions: skill.instructions,
          };
        },
      }),
      importSkillFromUrl: tool({
        description:
          "Import a skill from a SKILL.md file at a URL. Use when the user gives you a link to a SKILL.md file, such as a github.com blob URL or a raw markdown URL, and asks you to add it as a skill. Downloads the file and installs it; if a skill with the same name already exists it is replaced.",
        inputSchema: z.object({
          url: z
            .string()
            .trim()
            .min(1)
            .max(2048)
            .describe("URL to a SKILL.md file."),
        }),
        execute: async ({ url }) => {
          const { content, displayName } = await fetchSkillMarkdownFromUrl(url);
          const parsed = parseSkillMarkdown(content);
          const title =
            parsed.title ||
            displayName.replace(/\.md$/i, "") ||
            "Imported skill";
          const existing = await findSkillBySlug(title);
          const input = {
            autoMatch: parsed.autoMatch,
            description: parsed.description?.trim() || null,
            instructions: parsed.instructions.trim(),
            matchKeywords: parsed.matchKeywords,
            recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
            recommendedMcpServerIds: parsed.recommendedMcpServerIds,
            sourceMarkdown: content,
            title,
          };

          let skill: Awaited<ReturnType<SkillRepository["getById"]>>;

          if (existing) {
            await repository.update(existing.id, input);
            skill = await repository.getById(existing.id);
          } else {
            skill = await repository.create(input);
          }

          onSkillsChange?.();

          onRecord?.(
            createRecord({
              toolName: "importSkillFromUrl",
              status: "completed",
              inputSummary: summarizeValue({ url }),
              outputSummary: summarizeValue({
                name: skill?.title,
                replaced: Boolean(existing),
              }),
            }),
          );

          return {
            imported: true,
            replaced: Boolean(existing),
            id: skill?.id ?? null,
            name: skill?.title ?? title,
            description: skill?.description ?? null,
          };
        },
      }),
      manageSkill: tool({
        description:
          "Create, update, delete, or list skills. Skills follow the SKILL.md format: a name, a description that controls when the skill applies, and markdown instructions. Use createSkill when the user asks to add a skill; use updateSkill to modify an existing one; use deleteSkill to remove one; use listSkills to show available skills. Auto-match is enabled by default for created skills so they trigger when the description matches.",
        inputSchema: z
          .object({
            action: z.enum([
              "createSkill",
              "updateSkill",
              "deleteSkill",
              "listSkills",
            ]),
            name: z
              .string()
              .trim()
              .min(1)
              .max(MAX_TITLE_LENGTH)
              .optional()
              .describe("Skill name (kebab-case recommended)."),
            description: z
              .string()
              .trim()
              .min(1)
              .max(MAX_DESCRIPTION_LENGTH)
              .optional()
              .describe("When and why to use this skill."),
            instructions: z
              .string()
              .trim()
              .min(1)
              .max(MAX_INSTRUCTIONS_LENGTH)
              .optional()
              .describe(
                "The markdown instructions the agent follows when this skill applies.",
              ),
            keywords: z
              .array(z.string().trim().min(1).max(40))
              .max(MAX_KEYWORDS)
              .optional()
              .describe("Extra trigger keywords for auto-matching."),
            autoMatch: z
              .boolean()
              .optional()
              .describe(
                "Whether to auto-apply this skill when the description or keywords match the user's request. Defaults to true.",
              ),
            recommendedBuiltInToolKeys: builtInToolKeysSchema
              .optional()
              .describe(
                "Built-in tool keys this skill commonly needs, e.g. workspaceRead, workspaceWrite, workspaceEdit, workspaceCreateFile, workspaceListFiles, workspaceGrep, folderRead, folderWrite.",
              ),
          })
          .refine(
            (value) => value.action === "listSkills" || Boolean(value.name),
            { message: "name is required unless action is listSkills." },
          )
          .refine(
            (value) =>
              value.action !== "createSkill" || Boolean(value.instructions),
            { message: "instructions are required when creating a skill." },
          ),
        execute: async (args) => {
          const inputSummary = summarizeValue(args);

          if (args.action === "listSkills") {
            const skills = await repository.list();
            const catalog = skills
              .filter((skill) => skill.enabled)
              .map((skill) => formatSkillForCatalog(skill));

            onRecord?.(
              createRecord({
                toolName: "manageSkill",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({
                  count: catalog.length,
                  skills: catalog,
                }),
              }),
            );

            return {
              count: catalog.length,
              skills: catalog,
            };
          }

          if (args.action === "deleteSkill") {
            const skill = await findSkillBySlug(args.name as string);

            if (!skill) {
              return {
                deleted: false,
                message: `No skill named "${args.name}" exists.`,
              };
            }

            await repository.delete(skill.id);
            onSkillsChange?.();

            onRecord?.(
              createRecord({
                toolName: "manageSkill",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ deleted: skill.title }),
              }),
            );

            return {
              deleted: true,
              name: skill.title,
            };
          }

          const name =
            slugifySkillName(args.name as string) || (args.name as string);

          if (args.action === "createSkill") {
            const existing = await findSkillBySlug(name);

            if (existing) {
              return {
                created: false,
                message: `A skill named "${existing.title}" already exists. Use the updateSkill action to modify it instead of creating a duplicate.`,
              };
            }

            const skill = await repository.create({
              autoMatch: args.autoMatch ?? true,
              description: args.description?.trim() ?? null,
              instructions: (args.instructions as string).trim(),
              matchKeywords: args.keywords ?? [],
              recommendedBuiltInToolKeys: normalizeToolKeys(
                args.recommendedBuiltInToolKeys,
              ),
              title: name,
            });

            onSkillsChange?.();

            onRecord?.(
              createRecord({
                toolName: "manageSkill",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({
                  created: skill.title,
                  sourceMarkdown: serializeSkillToMarkdown(skill),
                }),
              }),
            );

            return {
              created: true,
              id: skill.id,
              name: skill.title,
              description: skill.description,
              autoMatch: skill.autoMatch,
              markdown: serializeSkillToMarkdown(skill),
            };
          }

          const skill = await findSkillBySlug(name);

          if (!skill) {
            return {
              updated: false,
              message: `No skill named "${name}" exists. Use the createSkill action to add it first.`,
            };
          }

          const updates: Parameters<SkillRepository["update"]>[1] = {
            autoMatch: args.autoMatch,
            description: args.description?.trim(),
            instructions: args.instructions,
            matchKeywords: args.keywords,
          };

          if (args.recommendedBuiltInToolKeys !== undefined) {
            updates.recommendedBuiltInToolKeys = normalizeToolKeys(
              args.recommendedBuiltInToolKeys,
            );
          }

          if (name !== skill.title) {
            updates.title = name;
          }

          await repository.update(skill.id, updates);

          const next = await repository.getById(skill.id);
          onSkillsChange?.();

          onRecord?.(
            createRecord({
              toolName: "manageSkill",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue({
                updated: skill.title,
                sourceMarkdown: next ? serializeSkillToMarkdown(next) : null,
              }),
            }),
          );

          return {
            updated: true,
            id: skill.id,
            name: skill.title,
            markdown: next ? serializeSkillToMarkdown(next) : null,
          };
        },
      }),
    },
  };
}
