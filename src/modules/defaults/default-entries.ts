import bundledMcpCatalog from "../../../catalog/mcp-servers.json";
import bundledSkillCatalog from "../../../catalog/skills.json";

import { parseMcpServerCatalog } from "@/modules/mcp/catalog";
import { parseSkillCatalog } from "@/modules/skills/catalog";
import { fetchSkillFiles } from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import {
  parseSkillMarkdown,
  slugifySkillName,
} from "@/modules/skills/skill-markdown";
import { createSkillSource } from "@/modules/skills/skill-sync";
import type { Repositories } from "@/core/db/repositories/types";

/**
 * Bump when new catalog entries are marked `defaultInstalled` so existing
 * installs seed them on the next launch. The stored value lives in app
 * settings under `DEFAULT_CATALOG_SEED_VERSION_KEY`.
 */
export const DEFAULT_CATALOG_SEED_VERSION = 1;

export const DEFAULT_CATALOG_SEED_VERSION_KEY = "default_catalog_seed_version";

export type SeedDefaultEntriesResult = {
  installedSkillIds: string[];
  installedMcpServerIds: string[];
};

/**
 * Installs catalog entries flagged `defaultInstalled` into the local database.
 *
 * - Uses the bundled catalogs so seeding is deterministic and never depends on
 *   the remote catalog being reachable.
 * - Idempotent: entries that already exist are skipped, so a partial failure
 *   (e.g. one download fails) retries only the missing entries next launch.
 * - Never throws: failures are reported in `errors` so a broken catalog entry
 *   or offline launch cannot crash startup or block other entries. The caller
 *   should only record the seed version when `errors` is empty.
 */
export async function seedDefaultEntries(
  repositories: Repositories,
): Promise<SeedDefaultEntriesResult & { errors: string[] }> {
  const result: SeedDefaultEntriesResult & { errors: string[] } = {
    errors: [],
    installedMcpServerIds: [],
    installedSkillIds: [],
  };

  // Local DB inserts first: no network, so at least the MCP defaults land
  // even when the device is offline on first launch.
  await seedDefaultMcpServers(repositories, result);
  await seedDefaultSkills(repositories, result);

  return result;
}

async function seedDefaultSkills(
  repositories: Repositories,
  result: SeedDefaultEntriesResult & { errors: string[] },
) {
  let entries: ReturnType<typeof parseSkillCatalog>;

  try {
    entries = parseSkillCatalog(bundledSkillCatalog).filter(
      (entry) => entry.defaultInstalled,
    );
  } catch (error) {
    result.errors.push(
      `Bundled skill catalog is invalid: ${describeError(error)}`,
    );
    return;
  }

  if (entries.length === 0) return;

  const existing = await repositories.skillRepository.list();
  const installedTitles = new Set(
    existing.map((skill) => slugifySkillName(skill.title)).filter(Boolean),
  );

  for (const entry of entries) {
    // The catalog label and the skill's own frontmatter title can differ, so
    // accept either as proof it is already installed.
    if (installedTitles.has(slugifySkillName(entry.label))) continue;

    try {
      const { content } = await fetchSkillMarkdownFromUrl(entry.url);
      const parsed = parseSkillMarkdown(content);
      const parsedSlug = slugifySkillName(parsed.title);

      // Re-check after parsing: a retry after a partial failure must not
      // create a duplicate when the frontmatter title differs from the label.
      if (parsedSlug && installedTitles.has(parsedSlug)) continue;

      const discovered = await fetchSkillFiles({
        sourceUrl: entry.url,
        referencedPaths: parsed.files,
        extraFiles: entry.extraFiles,
      });

      const skill = await repositories.skillRepository.create({
        autoMatch: parsed.autoMatch,
        description: parsed.description,
        enabled: true,
        files: discovered.map((file) => ({
          path: file.path,
          content: file.content,
          mimeType: file.mimeType,
          size: file.size,
        })),
        instructions: parsed.instructions,
        matchKeywords: parsed.matchKeywords,
        recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
        recommendedMcpServerIds: parsed.recommendedMcpServerIds,
        source: createSkillSource(
          entry.url,
          entry.extraFiles,
          discovered.map((file) => file.path),
        ),
        sourceMarkdown: content,
        title: parsed.title,
      });

      if (parsedSlug) installedTitles.add(parsedSlug);
      result.installedSkillIds.push(skill.id);
    } catch (error) {
      // Keep going so one unreachable skill does not block the rest; the
      // caller leaves the seed version unset and the next launch retries.
      result.errors.push(
        `Could not seed default skill "${entry.id}": ${describeError(error)}`,
      );
    }
  }
}

async function seedDefaultMcpServers(
  repositories: Repositories,
  result: SeedDefaultEntriesResult & { errors: string[] },
) {
  let presets: ReturnType<typeof parseMcpServerCatalog>;

  try {
    presets = parseMcpServerCatalog(bundledMcpCatalog).filter(
      (preset) => preset.defaultInstalled,
    );
  } catch (error) {
    result.errors.push(
      `Bundled MCP catalog is invalid: ${describeError(error)}`,
    );
    return;
  }

  if (presets.length === 0) return;

  const existing = await repositories.mcpServerRepository.list();
  const installedKeys = new Set(
    existing.map((server) => mcpServerKey(server.url, server.label)),
  );

  for (const preset of presets) {
    // Match on URL *and* label: the same endpoint can appear under multiple
    // presets (e.g. OAuth vs API-token variants), which are distinct servers.
    const key = mcpServerKey(preset.url, preset.label);

    if (installedKeys.has(key)) continue;

    try {
      const server = await repositories.mcpServerRepository.create({
        authMode: preset.authMode,
        // Only no-auth servers can work immediately. A default OAuth or
        // header-auth server would otherwise attach to conversations before
        // the user has connected credentials, so seed it disabled instead.
        enabled: preset.authMode === "none",
        headerNames: [],
        label: preset.label,
        oauthAllowedAuthOrigin: preset.oauthAllowedAuthOrigin,
        oauthAuthorizationUrl: preset.oauthAuthorizationUrl,
        oauthClientId: preset.oauthClientId,
        oauthMode: preset.oauthMode,
        oauthScopes: preset.oauthScopes,
        oauthTokenUrl: preset.oauthTokenUrl,
        transport: preset.transport,
        url: preset.url,
      });

      installedKeys.add(key);
      result.installedMcpServerIds.push(server.id);
    } catch (error) {
      result.errors.push(
        `Could not seed default MCP server "${preset.id}": ${describeError(error)}`,
      );
    }
  }
}

function mcpServerKey(url: string, label: string) {
  return `${url.replace(/\/+$/, "").toLowerCase()}::${label.trim().toLowerCase()}`;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
