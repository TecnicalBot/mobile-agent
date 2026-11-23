import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig, SkillSource } from "@/core/types/app-state";
import { fetchSkillFiles, type SkillAttachment } from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";

export type SkillSyncResult = {
  skill: SkillConfig;
  updated: boolean;
};

export type SkillSyncSummary = {
  error?: string;
  id: string;
  title: string;
  updated: boolean;
};

export function createSkillSource(
  url: string,
  extraFiles: string[] = [],
  filePaths: string[] = [],
): SkillSource {
  return {
    url: url.trim(),
    extraFiles: [...new Set(extraFiles.map((file) => file.trim()).filter(Boolean))],
    filePaths: [...new Set(filePaths)],
    syncedAt: new Date().toISOString(),
  };
}

function sameFiles(current: SkillConfig["skillFiles"], next: SkillAttachment[]) {
  if (current.length !== next.length) return false;
  const byPath = new Map(current.map((file) => [file.path, file]));
  return next.every(
    (file) => byPath.get(file.path)?.content === file.content,
  );
}

export async function syncSkillFromSource(
  repository: SkillRepository,
  skillId: string,
): Promise<SkillSyncResult> {
  const original = await repository.getById(skillId);
  if (!original) throw new Error("Skill not found.");
  if (!original.source?.url) {
    throw new Error("This skill has no saved source. Re-import it from its original URL to enable sync.");
  }

  const { url, extraFiles } = original.source;
  const { content } = await fetchSkillMarkdownFromUrl(url);
  const parsed = parseSkillMarkdown(content);
  // Finish every download before replacing anything. A rate limit or partial
  // download must not delete previously installed files.
  const downloaded = await fetchSkillFiles({
    sourceUrl: url,
    referencedPaths: parsed.files,
    extraFiles,
    strict: true,
  });
  const current = await repository.getById(skillId);
  if (!current) throw new Error("Skill not found.");
  if (current.source?.url !== url) {
    throw new Error("The skill's source changed during sync. Please try again.");
  }

  // Files that came from the source last time are replaced by the fresh copy;
  // files the user added locally are kept.
  const remotePaths = new Set(current.source.filePaths);
  const files = new Map<string, SkillAttachment>(
    current.skillFiles
      .filter((file) => !remotePaths.has(file.path))
      .map((file) => [file.path, file]),
  );
  for (const file of downloaded) files.set(file.path, file);

  // URL imports may also keep a copy of the main document in the file browser.
  const remoteFilePaths = downloaded.map((file) => file.path);
  if (remotePaths.has("SKILL.md")) {
    files.set("SKILL.md", {
      path: "SKILL.md",
      content,
      mimeType: "text/markdown",
      size: new TextEncoder().encode(content).byteLength,
    });
    remoteFilePaths.push("SKILL.md");
  }

  const nextFiles = [...files.values()];
  const updated = current.sourceMarkdown !== content ||
    !sameFiles(current.skillFiles, nextFiles);

  await repository.update(skillId, {
    ...(updated ? { sourceMarkdown: content, files: nextFiles } : {}),
    source: createSkillSource(url, extraFiles, remoteFilePaths),
    // Do not change enabled: disabled skills stay disabled after syncing.
  });
  const skill = await repository.getById(skillId);
  if (!skill) throw new Error("Skill not found.");
  return { skill, updated };
}
