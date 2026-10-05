import { Directory, File, Paths } from "expo-file-system";
import { PermissionsAndroid, Platform } from "react-native";

import { saveDownload } from "../../../modules/saf-file-operations";

/** Export an existing local file to the device's public Downloads collection. */
export async function downloadFile(uri: string, name: string, mimeType: string) {
  if (Platform.OS === "android") {
    if (Number(Platform.Version) < 29) {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error("Storage permission is required to save to Downloads.");
      }
    }
    return saveDownload(uri, name, mimeType);
  }
  const directory = new Directory(Paths.document, "Downloads");
  directory.create({ idempotent: true, intermediates: true });
  let destination = new File(directory, name);
  const extension = destination.extension;
  const base = extension ? name.slice(0, -extension.length) : name;
  let suffix = 1;
  while (destination.exists) {
    destination = new File(directory, `${base} (${suffix++})${extension}`);
  }
  await new File(uri).copy(destination);
  return { uri: destination.uri, name: destination.name };
}

export async function downloadText(code: string, name: string, mimeType: string) {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(code);
  try {
    return await downloadFile(file.uri, name, mimeType);
  } finally {
    file.delete();
  }
}
