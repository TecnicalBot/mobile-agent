import { Directory, File, Paths } from "expo-file-system";
import { tool } from "ai";
import { z } from "zod";

import { downloadFile as saveToDeviceDownloads } from "@/core/services/download-service";
import {
  createWorkspaceFileService,
  resolveWorkspaceFile,
  sanitizeFileName,
} from "@/core/services/workspace-file-service";
import { buildEditorTimelineFiles } from "@/modules/preview/editor-timeline";
import { writeEditorZip, type EditorZipEntry } from "@/modules/preview/editor-zip";
import {
  hashDocumentKey,
  renderSegments,
  type EditorClipRenderResult,
} from "@/modules/preview/render-segments";
import {
  inlineAudioAssets,
  inlineImageAssets,
  inlineVideoAssets,
} from "@/modules/preview/video-assets";
import { readContractDuration } from "@/modules/preview/video-audio";
import { VIDEO_RUNTIME_GUIDANCE } from "@/modules/preview/video-runtime-guidance";
import { MAX_VIDEO_DURATION_SECONDS } from "@/modules/preview/video-render";
import { resolveHtml } from "@/modules/tools/built-in/render-video";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

const MAX_HTML_CHARS = 2_000_000;
const DEFAULT_ALBUM = "Mobile Agent Edits";

/**
 * Renders the HTML video contract into an editor-ready package: one MP4 per
 * shot/gap, portable timelines (FCPXML, FCP7 XML, OTIO, EDL, CSV), and a
 * finished full-length MP4. Mobile editors import the clips from a gallery
 * album; desktop NLEs import the ZIP's timeline files.
 */
export function createExportEditorPackageTool({
  conversationId,
  onProgress,
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);
  return tool({
    description:
      VIDEO_RUNTIME_GUIDANCE +
      "\n\n" +
      "Export a video as an editor-ready package so the user can import it into CapCut (mobile or desktop), KineMaster, VN/InShot, Premiere Pro, DaVinci Resolve, or Final Cut Pro. This renders the same MOBILE_AGENT_VIDEO HTML contract as renderVideo, but also cuts the timeline into one MP4 per shot (and per gap), builds FCPXML / FCP7 XML / OTIO / CMX3600 EDL / shots.csv timelines, and zips them together. The clips and the finished full video are copied into a gallery album for mobile editors, the finished video is saved as a playable workspace video, and the ZIP is saved to the workspace plus the device Downloads folder. Declare `shots` in the contract so each story beat becomes its own clip; without shots the package contains a single clip equal to the full video. Rendering is real time and slower than renderVideo because every clip is joined separately, so call this once with a finished scene. Pass `duration` with the length you promised. Returns `videoFileId`/`videoLink` for the finished MP4 (embed it inline with ![name](workspace://videoFileId)), and `fileId`/`link` for the ZIP package. Use renderVideo instead when the user only wants the finished MP4.",
    inputSchema: z.object({
      html: z
        .string()
        .min(1)
        .max(MAX_HTML_CHARS)
        .optional()
        .describe(
          "The complete self-contained HTML document implementing the MOBILE_AGENT_VIDEO contract.",
        ),
      fileId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Alternatively, the id of an existing workspace .html file to export.",
        ),
      name: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          "Base name for the outputs, e.g. `black-hole`. The finished video becomes `black-hole.mp4`; the package becomes `black-hole-editor-package.zip`.",
        ),
      duration: z
        .number()
        .min(1)
        .max(MAX_VIDEO_DURATION_SECONDS)
        .optional()
        .describe(
          "Expected video length in seconds. Must match the `duration` field in the HTML contract or the export fails fast.",
        ),
      album: z
        .string()
        .min(1)
        .max(60)
        .optional()
        .describe(
          'Gallery album name for the clips and finished video (default "Mobile Agent Edits"). Use letters, numbers, spaces, underscores, or dashes.',
        ),
    }),
    execute: async ({ album, duration, fileId, html, name }, { abortSignal }) => {
      const inputSummary = summarizeValue({
        hasHtml: Boolean(html),
        fileId: fileId ?? null,
        name: name ?? null,
        duration: duration ?? null,
        album: album ?? null,
      });

      let packageDirectory: Directory | null = null;

      try {
        const rawHtml = await resolveHtml({
          fileId,
          html,
          repository,
          workspaceService,
        });

        if (!rawHtml.includes("MOBILE_AGENT_VIDEO")) {
          throw new Error(
            "The HTML is missing the window.MOBILE_AGENT_VIDEO contract, so there is nothing to record.",
          );
        }

        const contractDuration = readContractDuration(rawHtml);
        if (contractDuration == null && duration == null) {
          throw new Error(
            "The video duration is unknown. Pass `duration` (the contract's length in seconds) and try again.",
          );
        }
        if (
          duration != null &&
          contractDuration != null &&
          Math.abs(contractDuration - duration) > 0.5
        ) {
          throw new Error(
            `The HTML contract duration (${contractDuration} s) does not match the requested duration (${duration} s). Read the source, fix the contract's duration field (and scale audio cue timings to it), then retry — exporting now would produce a wrong-length video.`,
          );
        }

        const base = outputBaseName(name);
        const outputName = `${base}.mp4`;

        // Save the exact source alongside the outputs so follow-up revisions
        // can read and edit this file instead of regenerating blind.
        const sourceFile = await workspaceService.createTextFile({
          content: rawHtml,
          isIntermediate: true,
          mimeType: "text/html",
          name: `${base}.source.html`,
        });

        const { html: audioHtml, audioFiles } = await inlineAudioAssets(
          rawHtml,
          repository,
        );
        const { html: imageHtml, imageFiles } = await inlineImageAssets(
          audioHtml,
          repository,
        );
        const {
          html: documentHtml,
          videoFiles,
          warnings: clipWarnings,
        } = await inlineVideoAssets(imageHtml, repository);

        const result = await renderSegments({
          abortSignal,
          conversationId,
          contractDuration: contractDuration ?? duration ?? null,
          documentHtml,
          editorClips: true,
          onProgress,
          sourceFileId: hashDocumentKey(documentHtml),
        });

        if (!result.clips || !result.editorPackage) {
          throw new Error(
            "The render finished without editor clips. Re-run the export; completed segments are kept.",
          );
        }

        packageDirectory = new Directory(result.editorPackage.directoryUri);
        const clipResults = result.clips;
        const fps = result.editorPackage.fps;
        const { width, height } = result.editorPackage;
        const timelineDuration = result.duration ?? contractDuration ?? duration ?? 0;

        // Give the finished video the requested name before it reaches the
        // gallery, so mobile editors list `demo.mp4` rather than `full.mp4`.
        let fullFile = new File(result.uri);
        const namedFullFile = new File(packageDirectory, outputName);
        if (fullFile.uri !== namedFullFile.uri) {
          try {
            await fullFile.move(namedFullFile, { overwrite: true });
            fullFile = namedFullFile;
          } catch {
            // Keep the original cache name; the gallery still gets the video.
          }
        }

        const gallery = await saveToGallery({
          albumName: sanitizeAlbumName(album),
          clipUris: clipResults.map((clip) => clip.uri),
          fullUri: fullFile.uri,
        });

        const timelines = buildEditorTimelineFiles({
          name: base,
          fps,
          width,
          height,
          duration: timelineDuration,
          clips: clipResults,
          galleryAlbum: gallery.album,
        });

        const zipCacheFile = new File(
          Paths.cache,
          `${base}-editor-package-${Date.now()}.zip`,
        );
        zipCacheFile.create({ overwrite: true, intermediates: true });

        try {
          await writeEditorZip(zipCacheFile, buildZipEntries(clipResults, timelines));
        } catch (error) {
          try {
            zipCacheFile.delete();
          } catch {
            // Best-effort cleanup of a partial archive.
          }
          throw new Error(
            `Editor package files were built, but creating the ZIP failed. ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const zipFile = await workspaceService.createDocumentFileFromFile({
          source: zipCacheFile,
          mimeType: "application/zip",
          name: `${base}-editor-package.zip`,
        });

        // The finished video is delivered separately (playable in chat), not
        // inside the ZIP: it already contains the same footage as every clip.
        const videoFile = await workspaceService.createDocumentFileFromFile({
          source: fullFile,
          mimeType: "video/mp4",
          name: outputName,
        });

        const download = await copyPackageToDownloads(zipFile.relativePath);

        const warnings = [
          ...clipWarnings,
          ...result.warnings,
          ...(result.perfWarnings ?? []),
          ...gallery.warnings,
          ...download.warnings,
        ];

        const output = {
          fileId: zipFile.id,
          displayName: zipFile.displayName,
          link: `workspace://${zipFile.id}`,
          mimeType: "application/zip",
          size: zipFile.size,
          videoFileId: videoFile.id,
          videoDisplayName: videoFile.displayName,
          videoLink: `workspace://${videoFile.id}`,
          videoSize: videoFile.size,
          videoDuration: timelineDuration,
          videoMimeType: "video/mp4",
          sourceFileId: sourceFile.id,
          sourceLink: `workspace://${sourceFile.id}`,
          galleryAlbum: gallery.album,
          downloadsUri: download.uri,
          clipCount: clipResults.length,
          clips: clipResults.map((clip) => ({
            fileName: clip.fileName,
            label: clip.label,
            start: clip.start,
            end: clip.end,
            duration: clip.duration,
            hasAudio: clip.hasAudio,
            ...(clip.shotId ? { shotId: clip.shotId } : {}),
          })),
          fps,
          width,
          height,
          hasAudio: result.hasAudio,
          audioWarnings: result.audioWarnings,
          audioFiles,
          imageFiles,
          videoFiles,
          warnings,
          timings: result.timings,
          phases: result.phases,
          encoder: result.encoder,
          visualWarnings: result.visualWarnings ?? [],
          ...(result.incremental ? { incremental: result.incremental } : {}),
        };

        onRecord?.(
          createRecord({
            toolName: "exportEditorPackage",
            status: "completed",
            inputSummary,
            preview: {
              title: zipFile.displayName,
              text: formatEditorPackagePreview(output),
            },
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "exportEditorPackage",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      } finally {
        if (packageDirectory) {
          try {
            packageDirectory.delete();
          } catch {
            // Best-effort; the derived clips are already in the gallery/ZIP.
          }
        }
      }
    },
  });
}

function buildZipEntries(
  clips: EditorClipRenderResult[],
  timelines: ReturnType<typeof buildEditorTimelineFiles>,
): EditorZipEntry[] {
  return [
    ...clips.map(
      (clip): EditorZipEntry => ({
        kind: "file",
        name: `clips/${clip.fileName}`,
        file: new File(clip.uri),
      }),
    ),
    { kind: "text", name: "README.txt", text: timelines.readme },
    { kind: "text", name: "timeline.fcpxml", text: timelines.fcpxml },
    { kind: "text", name: "timeline-fcp7.xml", text: timelines.fcp7Xml },
    { kind: "text", name: "timeline.otio", text: timelines.otio },
    { kind: "text", name: "timeline.edl", text: timelines.edl },
    { kind: "text", name: "shots.csv", text: timelines.csv },
  ];
}

/**
 * Copies the package into the device's public Downloads collection. Failure is
 * a warning: the workspace copy is still deliverable.
 */
async function copyPackageToDownloads(relativePath: string) {
  try {
    const file = resolveWorkspaceFile(relativePath);
    const saved = await saveToDeviceDownloads(
      file.uri,
      file.name,
      "application/zip",
    );
    return { uri: saved.uri, warnings: [] as string[] };
  } catch (error) {
    return {
      uri: null,
      warnings: [
        `The ZIP is in the workspace, but copying it to Downloads failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * Copies the clips and finished video into a gallery album. Mobile editors
 * (CapCut, KineMaster, VN/InShot) import media from the gallery, so this is
 * their path into the edit; a denied permission degrades to a warning because
 * the ZIP and workspace video still work.
 */
async function saveToGallery(options: {
  albumName: string;
  clipUris: string[];
  fullUri: string;
}) {
  try {
    // Loaded lazily so expo-media-library (a native-only module) is never
    // evaluated in the node/server-manifest bundle during `export:embed`.
    const mediaLibrary = await import("expo-media-library");
    const permission = await mediaLibrary.requestPermissionsAsync(true);

    if (!permission.granted) {
      return {
        album: null,
        warnings: [
          "Gallery access was not granted, so the clips were not copied to an album. The ZIP package and finished video are still available.",
        ],
      };
    }

    const uris = [...options.clipUris, options.fullUri];
    await mediaLibrary.Album.create(options.albumName, uris, false);
    return { album: options.albumName, warnings: [] as string[] };
  } catch (error) {
    return {
      album: null,
      warnings: [
        `Could not copy the clips to the gallery album: ${error instanceof Error ? error.message : String(error)}. The ZIP package and finished video are still available.`,
      ],
    };
  }
}

function outputBaseName(name: string | undefined) {
  const fallback = `video-${Date.now()}`;
  const raw = (name ?? fallback).trim() || fallback;
  const withoutExtension = raw.replace(/\.(mp4|m4v|mov|zip)$/i, "");
  return sanitizeFileName(withoutExtension);
}

function sanitizeAlbumName(value: string | undefined) {
  const cleaned = (value ?? DEFAULT_ALBUM)
    .replace(/[^\w -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || DEFAULT_ALBUM;
}

function formatEditorPackagePreview(output: {
  clipCount: number;
  downloadsUri: string | null;
  galleryAlbum: string | null;
  videoDuration: number;
  videoSize: number | null;
  width: number;
  height: number;
  fps: number;
  warnings: string[];
}) {
  const lines = [
    `${output.clipCount} clip${output.clipCount === 1 ? "" : "s"} · ${output.width}x${output.height} @ ${output.fps} fps · ${formatDuration(output.videoDuration)} full video (${formatBytes(output.videoSize)})`,
    output.galleryAlbum
      ? `Gallery album: ${output.galleryAlbum}`
      : "Gallery album: not saved",
    output.downloadsUri ? "ZIP also copied to Downloads" : "ZIP saved to workspace only",
  ];

  const shownWarnings = output.warnings.slice(0, 2);
  for (const warning of shownWarnings) {
    lines.push(`Warning: ${warning}`);
  }
  if (output.warnings.length > shownWarnings.length) {
    lines.push(`+${output.warnings.length - shownWarnings.length} more warning(s)`);
  }

  return lines.join("\n");
}

function formatBytes(size: number | null | undefined) {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return "unknown size";
  }
  if (size < 1024) return `${size} B`;

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown length";
  if (seconds < 60) {
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}
