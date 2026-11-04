import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService, resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import { readContractDuration } from "@/modules/preview/video-audio";
import {
  inlineImageAssets,
  inlineVideoAssets,
} from "@/modules/preview/video-assets";
import { requestScenePreview } from "@/modules/preview/video-preview";
import { createContactSheet, MAX_CONTACT_SHEET_FRAMES } from "@/modules/preview/contact-sheet";
import {
  createRecord,
  summarizeValue,
} from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { resolveHtml } from "@/modules/tools/built-in/render-video";

const MAX_PREVIEW_FRAMES = MAX_CONTACT_SHEET_FRAMES;

type PreviewSceneContentItem = Record<string, unknown>;

export type PreviewSceneOutput = {
  content?: PreviewSceneContentItem[];
  text?: string;
  frames?: unknown;
  frameCount?: number;
  warnings?: unknown;
  layout?: string;
  times?: number[];
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Default storyboard: start, quarters, and just before the end. */
export function defaultStoryboardTimes(duration: number): number[] {
  const d = Math.max(0.05, duration);
  const times = [0, d * 0.25, d * 0.5, d * 0.75, Math.max(0, d - 0.05)];
  return [...new Set(times.map(round2))];
}

/**
 * Cleans requested timestamps: finite, inside the video, ascending, unique,
 * at most MAX_PREVIEW_FRAMES. Out-of-range times clamp (with a warning)
 * instead of failing — the storyboard is approximate by design.
 */
export function normalizePreviewTimes(
  times: number[] | undefined,
  duration: number,
  fallback: number[],
): { times: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const raw = Array.isArray(times) && times.length > 0 ? times : fallback;
  const cleaned: number[] = [];
  for (const t of raw) {
    if (!Number.isFinite(t)) continue;
    const clamped = Math.min(Math.max(0, t), duration);
    if (clamped !== t) {
      warnings.push(
        `Preview time ${t}s is outside the ${duration}s video and was clamped to ${round2(clamped)}s.`,
      );
    }
    cleaned.push(round2(clamped));
  }
  const unique = [...new Set(cleaned)].sort((a, b) => a - b);
  if (unique.length > MAX_PREVIEW_FRAMES) {
    warnings.push(
      `Only the first ${MAX_PREVIEW_FRAMES} preview times were captured.`,
    );
  }
  const finalTimes = unique.slice(0, MAX_PREVIEW_FRAMES);
  if (finalTimes.length === 0) {
    warnings.push("No valid preview timestamps; captured the opening frame.");
    return { times: [0], warnings };
  }
  return { times: finalTimes, warnings };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Captures stills of a video scene before spending render time on it. Use
 * this after authoring a scene (especially with user images, clips, or
 * tricky layout) and before calling `renderVideo`: it runs the scene's
 * `render(t, ...)` at storyboard timestamps in a hidden host and shows you
 * the frames, so composition, framing, and caption placement can be fixed
 * while iteration is cheap.
 *
 * The preview is approximate — async media settles, no audio plays — and the
 * render stays the truth. File-audio tracks are not inlined (nothing plays);
 * image and clip assets are, exactly as for export.
 */
export function createPreviewSceneTool({
  onRecord,
  repository,
  supportsImageInput = true,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);
  return tool({
    description:
      "Look at a video scene before rendering it. Pass the scene HTML or fileId and optional times (up to 12). Multi-frame previews return ONE compact contact sheet with numbered timestamps by default, not separate vision images. Use layout: frames only for detailed full-resolution inspection. Vision-capable models see the image inline; otherwise use the saved image with ocr. The preview is approximate (media settles, no audio plays); the render is truth.",
    inputSchema: z.object({
      html: z
        .string()
        .min(1)
        .optional()
        .describe("The complete scene HTML (same document renderVideo takes)."),
      fileId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The id of a workspace HTML file holding the scene (e.g. a .source.html from a previous render).",
        ),
      duration: z
        .number()
        .min(1)
        .max(45)
        .optional()
        .describe(
          "Expected video length in seconds. Must match the `duration` field in the scene contract.",
        ),
      times: z
        .array(z.number().min(0).max(45))
        .max(MAX_PREVIEW_FRAMES)
        .optional()
        .describe(
          "Timestamps in seconds to capture (default: a 5-frame storyboard across the scene).",
        ),
      layout: z.enum(["contactSheet", "frames"]).optional().describe("Default: contactSheet. Use frames for full-resolution individual stills."),
      name: z
        .string()
        .min(1)
        .max(60)
        .optional()
        .describe("Base file name for the saved stills."),
    }),
    execute: async (
      {
        html,
        fileId,
        duration,
        times,
        name,
        layout = "contactSheet",
      }: {
        html?: string;
        fileId?: string;
        duration?: number;
        times?: number[];
        name?: string;
        layout?: "contactSheet" | "frames";
      },
      { abortSignal },
    ) => {
      const inputSummary = summarizeValue({
        hasHtml: Boolean(html),
        fileId: fileId ?? null,
        duration: duration ?? null,
        times: times ?? null,
        name: name ?? null,
        layout,
      });

      try {
        const rawHtml = await resolveHtml({
          fileId,
          html,
          repository,
          workspaceService,
        });
        const contractDuration = readContractDuration(rawHtml);
        if (
          duration != null &&
          contractDuration != null &&
          Math.abs(contractDuration - duration) > 0.5
        ) {
          throw new Error(
            `The scene contract duration (${contractDuration} s) does not match the requested duration (${duration} s). Fix the contract's duration field and retry — previewing now would check the wrong scene.`,
          );
        }
        const videoDuration = duration ?? contractDuration;
        if (!(videoDuration != null && videoDuration > 0)) {
          throw new Error(
            "Cannot storyboard this scene: pass `duration` (1–45 s) matching the contract's duration field.",
          );
        }

        // Image and clip assets inline exactly as for export, minus the native
        // caches that only change render speed; a preview must open now.
        const { html: imageHtml } = await inlineImageAssets(rawHtml, repository);
        const { html: sceneHtml, warnings: clipWarnings } = await inlineVideoAssets(
          imageHtml,
          repository,
          "preview",
        );

        const storyboard = normalizePreviewTimes(
          times,
          videoDuration,
          defaultStoryboardTimes(videoDuration),
        );

        const preview = await requestScenePreview(sceneHtml, {
          times: storyboard.times,
          signal: abortSignal,
        });
        const warnings = [...storyboard.warnings, ...clipWarnings, ...preview.warnings];

        if (preview.frames.length === 0) {
          throw new Error(
            `Scene preview produced no frames.${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}`,
          );
        }

        const baseName = (name ?? "scene").trim() || "scene";
        const previewImages: { uri: string; title: string }[] = [];
        const frames: {
          fileId: string;
          link: string;
          time?: number;
          times?: number[];
          width: number;
          height: number;
        }[] = [];
        const inlineParts: { type: "file"; data: Uint8Array; mediaType: string }[] = [];
        const useSheet = layout === "contactSheet" && preview.frames.length > 1;
        const images = useSheet
          ? [await createContactSheet(preview.frames, abortSignal)]
          : preview.frames;
        for (const frame of images) {
          const bytes = base64ToBytes(frame.base64);
          const saved = await workspaceService.createDocumentFile({
            bytes,
            mimeType: "image/jpeg",
            name: useSheet ? `${baseName}-contact-sheet.jpg` : `${baseName}-preview-${frame.time}s.jpg`,
          });
          previewImages.push({ uri: resolveWorkspaceFile(saved.relativePath).uri, title: useSheet ? "Contact sheet" : `${frame.time}s` });
          frames.push({
            fileId: saved.id,
            link: `workspace://${saved.id}`,
            ...(useSheet ? { times: preview.frames.map((f) => f.time) } : { time: frame.time }),
            width: frame.width,
            height: frame.height,
          });
          inlineParts.push({
            type: "file" as const,
            data: bytes,
            mediaType: "image/jpeg",
          });
        }

        const text =
          `Storyboard of "${baseName}" (${videoDuration}s, ${preview.frames.length} frames${useSheet ? ", one contact sheet; read left-to-right, top-to-bottom: " + preview.frames.map((f, i) => `${i + 1}=${f.time}s`).join(", ") : ""}): ` +
          frames.map((f) => `${useSheet ? "contact sheet" : `${f.time}s`} as workspace://${f.fileId}`).join(", ") +
          ". Describe what you see at each timestamp when replying.";

        const output: PreviewSceneOutput = supportsImageInput
          ? {
              content: [{ type: "text" as const, text }, ...inlineParts],
              frames,
              frameCount: preview.frames.length,
              layout: useSheet ? "contactSheet" : "frames",
              times: preview.frames.map((f) => f.time),
              warnings,
            }
          : {
              text:
                `${text} Your model cannot display images, so inspect ` +
                `the saved stills with the ocr tool for on-screen text, or ask ` +
                `the user what they see at each timestamp.`,
              frames,
              frameCount: preview.frames.length,
              layout: useSheet ? "contactSheet" : "frames",
              times: preview.frames.map((f) => f.time),
              warnings,
            };

        onRecord?.(
          createRecord({
            toolName: "previewScene",
            status: "completed",
            inputSummary,
            preview: { title: baseName, images: previewImages, text: warnings.length ? warnings.join("\n") : undefined },
            outputSummary: summarizeValue({
              frameCount: preview.frames.length,
              layout: useSheet ? "contactSheet" : "frames",
              frames: frames.map((f) => ({
                fileId: f.fileId,
                link: f.link,
                time: f.time,
              })),
              warnings,
              inlineImage: supportsImageInput,
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "previewScene",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
    // Without this the SDK ships execute's return (including the storyboard
    // JPEG bytes) to the model as a giant JSON blob instead of real vision
    // content — the same failure getVideoFrame had. Normalize the raw file
    // parts into tagged FileData so the frames arrive as images. Text (with
    // the workspace:// links) always survives; frames whose bytes are
    // missing are skipped rather than sent broken.
    toModelOutput: ({ output }: { output: any }) => {
      const content = Array.isArray((output as PreviewSceneOutput)?.content)
        ? (output as PreviewSceneOutput).content!
        : null;
      if (!supportsImageInput || !content) {
        const text =
          output && typeof output === "object"
            ? (output as PreviewSceneOutput).text ?? ""
            : "";
        return { type: "text", value: text };
      }
      const value: (
        | { type: "text"; text: string }
        | {
            type: "file";
            data: { type: "data"; data: Uint8Array };
            mediaType: string;
            filename?: string;
          }
      )[] = [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const record = item as {
          type?: unknown;
          text?: unknown;
          data?: unknown;
          mediaType?: unknown;
          filename?: unknown;
        };
        if (record.type === "text" && typeof record.text === "string") {
          value.push({ type: "text", text: record.text });
          continue;
        }
        if (record.type !== "file") continue;
        const raw =
          record.data &&
          typeof record.data === "object" &&
          "type" in record.data
            ? (record.data as { data?: unknown }).data
            : record.data;
        if (!(raw instanceof Uint8Array)) continue;
        if (typeof record.mediaType !== "string") continue;
        value.push({
          type: "file",
          data: { type: "data", data: raw },
          mediaType: record.mediaType,
          ...(typeof record.filename === "string"
            ? { filename: record.filename }
            : {}),
        });
      }
      if (value.length === 0) {
        return { type: "text", value: output?.text ?? "" };
      }
      return { type: "content", value };
    },
  });
}
