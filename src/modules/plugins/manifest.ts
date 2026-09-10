const HEADER_RE = /^\/\/\s*@mobile-agent-plugin\s+({.+})\s*$/m;
export const MAX_PLUGIN_SOURCE_SIZE = 1_048_576;

export type PluginManifest = {
  author?: string;
  description?: string;
  name: string;
  version: string;
};

export type PluginManifestResult =
  | { manifest: PluginManifest; ok: true }
  | { error: string; ok: false };

export function parsePluginManifest(source: string): PluginManifestResult {
  if (source.length > MAX_PLUGIN_SOURCE_SIZE) {
    return {
      error: `Plugin source exceeds ${MAX_PLUGIN_SOURCE_SIZE} characters.`,
      ok: false,
    };
  }

  const raw = source.match(HEADER_RE)?.[1];
  if (!raw) {
    return {
      error: "Missing // @mobile-agent-plugin { ... } header.",
      ok: false,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "Plugin header is not valid JSON.", ok: false };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Plugin header must contain a JSON object.", ok: false };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    return { error: "Plugin header requires a name.", ok: false };
  }
  if (typeof record.version !== "string" || !record.version.trim()) {
    return { error: "Plugin header requires a version.", ok: false };
  }

  return {
    manifest: {
      author: typeof record.author === "string" ? record.author : undefined,
      description:
        typeof record.description === "string" ? record.description : undefined,
      name: record.name.trim(),
      version: record.version.trim(),
    },
    ok: true,
  };
}

export function manifestToId(manifest: PluginManifest) {
  return `plugin/${manifest.name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}
