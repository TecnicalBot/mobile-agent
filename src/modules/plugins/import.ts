import type { PluginConfig } from "@/core/types/app-state";

import type { Repositories } from "@/core/db/repositories/types";
import { manifestToId, parsePluginManifest } from "./manifest";
import { writePluginFile } from "./plugin-files";
import { extractRequiredSecretKeys } from "./secret-keys";

export type PluginImportResult =
  | { ok: true; plugin: PluginConfig; wasUpdate: boolean }
  | { ok: false; error: string };

export async function fetchPluginFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export async function importPluginSource(
  source: string,
  repositories: Repositories,
  sourceUrl?: string,
): Promise<PluginImportResult> {
  const result = parsePluginManifest(source);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const { manifest } = result;
  const id = manifestToId(manifest);

  try {
    const filePath = await writePluginFile(id, source);
    const requiredSecrets = extractRequiredSecretKeys(source);
    const existing = await repositories.pluginRepository.getById(id);

    if (existing) {
      await repositories.pluginRepository.update(id, {
        filePath,
        version: manifest.version,
        description: manifest.description ?? null,
        author: manifest.author ?? null,
        sourceUrl: sourceUrl ?? existing.sourceUrl,
        requiredSecrets,
        lastError: null,
      });

      const updated = await repositories.pluginRepository.getById(id);

      if (!updated) {
        return { ok: false, error: "Failed to read updated plugin" };
      }

      return { ok: true, plugin: updated, wasUpdate: true };
    }

    const plugin = await repositories.pluginRepository.create({
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      filePath,
      sourceUrl: sourceUrl ?? null,
      enabled: true,
      requiredSecrets,
    });

    return { ok: true, plugin, wasUpdate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Import failed: ${message}` };
  }
}
