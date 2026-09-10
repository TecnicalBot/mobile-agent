import { Directory, File, Paths } from "expo-file-system";

const PLUGINS_DIR = new Directory(Paths.document, "mobile-agent/plugins");

function ensurePluginsDir() {
  if (!PLUGINS_DIR.exists) {
    PLUGINS_DIR.create({ idempotent: true, intermediates: true });
  }
}

export function getPluginFile(pluginId: string): File {
  ensurePluginsDir();
  return new File(PLUGINS_DIR, `${pluginId}.js`);
}

export async function writePluginFile(
  pluginId: string,
  source: string,
): Promise<string> {
  const file = getPluginFile(pluginId);
  file.create({ intermediates: true, overwrite: true });
  file.write(source);
  return file.uri;
}

export async function readPluginFile(pluginId: string): Promise<string | null> {
  const file = getPluginFile(pluginId);
  if (!file.exists) return null;
  return file.text();
}

export function deletePluginFile(pluginId: string): void {
  const file = getPluginFile(pluginId);
  if (file.exists) {
    file.delete();
  }
}
