import type { GeneratedVideoAttachment } from "@/core/types/app-state";

type ToolResultLike = {
  type?: string;
  toolName?: string;
  output?: unknown;
};

/**
 * Extracts the workspace MP4s produced by `renderVideo` and
 * `exportEditorPackage` tool calls so they can be attached to the assistant
 * message and shown as in-chat video cards.
 *
 * The tools already persisted the files, so this only reshapes the returned
 * metadata; it never touches the filesystem.
 */
export function collectGeneratedVideos(
  toolResults: readonly ToolResultLike[] | undefined,
): GeneratedVideoAttachment[] {
  if (!toolResults || toolResults.length === 0) {
    return [];
  }

  const videos: GeneratedVideoAttachment[] = [];
  const seen = new Set<string>();

  for (const result of toolResults) {
    if (result.type !== "tool-result") {
      continue;
    }

    if (
      result.toolName !== "renderVideo" &&
      result.toolName !== "exportEditorPackage"
    ) {
      continue;
    }

    const isEditorPackage = result.toolName === "exportEditorPackage";
    const output = result.output as
      | {
          fileId?: unknown;
          videoFileId?: unknown;
          displayName?: unknown;
          videoDisplayName?: unknown;
          link?: unknown;
          videoLink?: unknown;
          mimeType?: unknown;
          size?: unknown;
          videoSize?: unknown;
        }
      | null
      | undefined;

    // Editor packages deliver the playable MP4 separately from the ZIP, so
    // their video fields take precedence over the package file.
    const fileId = isEditorPackage ? output?.videoFileId : output?.fileId;
    const displayName = isEditorPackage
      ? output?.videoDisplayName
      : output?.displayName;
    const link = isEditorPackage ? output?.videoLink : output?.link;
    const size = isEditorPackage ? output?.videoSize : output?.size;

    if (typeof fileId !== "string" || !fileId) {
      continue;
    }

    if (seen.has(fileId)) {
      continue;
    }

    seen.add(fileId);
    videos.push({
      fileId,
      displayName:
        typeof displayName === "string" && displayName
          ? displayName
          : `${fileId}.mp4`,
      mimeType: "video/mp4",
      size: typeof size === "number" ? size : 0,
      uri:
        typeof link === "string" && link ? link : `workspace://${fileId}`,
    });
  }

  return videos;
}
