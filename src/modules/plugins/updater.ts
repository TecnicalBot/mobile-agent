import type { Repositories } from "@/core/db/repositories/types";
import { fetchPluginFromUrl } from "./import";
import { manifestToId, parsePluginManifest } from "./manifest";
import { writePluginFile } from "./plugin-files";

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseVersion(version: string): number[] {
  return version.split(".").map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });
}

function isNewerVersion(remote: string, local: string): boolean {
  const remoteParts = parseVersion(remote);
  const localParts = parseVersion(local);
  const length = Math.max(remoteParts.length, localParts.length);

  for (let i = 0; i < length; i++) {
    const r = remoteParts[i] ?? 0;
    const l = localParts[i] ?? 0;
    if (r > l) return true;
    if (r < l) return false;
  }

  return false;
}

function shouldCheck(lastCheck: string | null): boolean {
  if (!lastCheck) return true;
  const elapsed = Date.now() - new Date(lastCheck).getTime();
  return elapsed > UPDATE_CHECK_INTERVAL_MS;
}

export async function checkPluginUpdates(repositories: Repositories) {
  const plugins = await repositories.pluginRepository.listEnabled();

  const updatable = plugins.filter(
    (p) => p.sourceUrl && shouldCheck(p.lastUpdateCheck),
  );

  if (updatable.length === 0) return;

  await Promise.allSettled(
    updatable.map(async (plugin) => {
      try {
        const source = await fetchPluginFromUrl(plugin.sourceUrl!);
        const result = parsePluginManifest(source);

        if (!result.ok) {
          await repositories.pluginRepository.update(plugin.id, {
            lastError: `Update failed: ${result.error}`,
            lastUpdateCheck: new Date().toISOString(),
          });
          return;
        }

        const remoteId = manifestToId(result.manifest);
        if (remoteId !== plugin.id) {
          await repositories.pluginRepository.update(plugin.id, {
            lastError: "Update skipped: plugin ID mismatch",
            lastUpdateCheck: new Date().toISOString(),
          });
          return;
        }

        if (!isNewerVersion(result.manifest.version, plugin.version)) {
          await repositories.pluginRepository.update(plugin.id, {
            lastUpdateCheck: new Date().toISOString(),
          });
          return;
        }

        await writePluginFile(plugin.id, source);
        await repositories.pluginRepository.update(plugin.id, {
          version: result.manifest.version,
          description: result.manifest.description ?? plugin.description,
          author: result.manifest.author ?? plugin.author,
          lastError: null,
          lastUpdateCheck: new Date().toISOString(),
        });
      } catch {
        await repositories.pluginRepository.update(plugin.id, {
          lastUpdateCheck: new Date().toISOString(),
        });
      }
    }),
  );
}
