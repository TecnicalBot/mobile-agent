import type { PluginConfig } from "@/core/types/app-state";

import type { Repositories } from "@/core/db/repositories/types";
import { validatePluginSource } from "./builder";
import { manifestToId, parsePluginManifest } from "./manifest";
import { writePluginFile } from "./plugin-files";
import { extractRequiredSecretKeys } from "./secret-keys";

export type PluginImportResult =
  | { ok: true; plugin: PluginConfig; wasUpdate: boolean }
  | { ok: false; error: string };

export async function fetchPluginFromUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a full HTTPS URL to a plugin .js file.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Plugin URLs must use HTTPS.");
  }

  const response = await fetch(parsed.href);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch plugin: ${response.status} ${response.statusText}. Check that the URL points to a raw .js file.`,
    );
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

  // Load the plugin once before storing it so a broken setup() or hook shape
  // is reported at import time instead of silently disabling the plugin on
  // the next app start.
  const validation = await validatePluginSource(source);
  if (!validation.ok) {
    return { ok: false, error: `Plugin failed to load: ${validation.error}` };
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
