import { Directory, File, Paths } from "expo-file-system";

function getPluginsDir() {
  return new Directory(Paths.document, "mobile-agent/plugins");
}

function ensurePluginsDir() {
  const directory = getPluginsDir();
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  return directory;
}

export function getPluginFile(pluginId: string): File {
  return new File(ensurePluginsDir(), `${pluginId}.js`);
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
