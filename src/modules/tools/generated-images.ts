import type { GeneratedFile } from "ai";
import { Directory, File, Paths } from "expo-file-system";
import { randomId } from "@/core/ids";

import type { GeneratedImageAttachment } from "@/core/types/app-state";

const GENERATED_IMAGE_ROOT = ["mobile-agent", "generated-images"] as const;

function getGeneratedImageDirectory() {
  return new Directory(Paths.document, ...GENERATED_IMAGE_ROOT);
}

function getExtensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

async function ensureGeneratedImageDirectory() {
  const directory = getGeneratedImageDirectory();

  if (!directory.exists) {
    directory.create({
      idempotent: true,
      intermediates: true,
    });
  }

  return directory;
}

export async function persistGeneratedImages(
  files: GeneratedFile[],
): Promise<GeneratedImageAttachment[]> {
  if (files.length === 0) {
    return [];
  }

  const directory = await ensureGeneratedImageDirectory();

  return files
    .filter((file) => file.mediaType.startsWith("image/"))
    .map((file) => {
      const id = randomId();
      const extension = getExtensionForMimeType(file.mediaType);
      const localFile = new File(directory, `${id}.${extension}`);

      localFile.create({
        intermediates: true,
        overwrite: true,
      });
      localFile.write(file.uint8Array);

      return {
        id,
        mimeType: file.mediaType,
        uri: localFile.uri,
      } satisfies GeneratedImageAttachment;
    });
}
