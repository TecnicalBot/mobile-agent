import { File } from "expo-file-system";
import { tool } from "ai";
import { getThumbnailAsync } from "expo-video-thumbnails";
import { z } from "zod";
import { createContactSheet, MAX_CONTACT_SHEET_FRAMES } from "@/modules/preview/contact-sheet";
import type { ScenePreviewFrame } from "@/modules/preview/video-preview";

import { createWorkspaceFileService, resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import {
  createRecord,
  summarizeValue,
} from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";

/**
 * Extracts a still frame from a workspace video so the agent can *see* a
 * timestamp ("at 0:12 the logo clips") instead of guessing from the script.
 *
 * Vision-capable models receive the frame inline as an image part plus the
 * saved workspace file. Models without image input get the saved file link
 * and are directed to the `ocr` tool for on-screen text. Either way the frame
 * is persisted, so follow-up turns can reference it by fileId.
 */

/**
 * execute's return value. `image` bytes travel here (in memory only) so
 * `toModelOutput` can build a real vision content part. They are never sent
 * to the model as raw JSON — see below.
 */
type VideoFrameOutput = {
  text: string;
  fileId: string;
  link: string;
  time?: number;
  times?: number[];
  frameCount?: number;
  width: number;
  height: number;
  inlineImage: boolean;
  image: Uint8Array | null;
};

export function createVideoFrameTool({
  onRecord,
  repository,
  supportsImageInput = true,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);
  return tool({
    description:
      "Inspect a workspace video. Pass fileId and either time for ONE full-resolution still, or times (up to 12 seconds-based timestamps) to capture a batch and return ONE compact, timestamp-labeled contact sheet. Prefer times for reviewing multiple moments: one tool call and one vision image, no separate reads needed. Use time for a closer look at small text or details. Non-vision models get a file link for ocr instead.",
    inputSchema: z.object({
      fileId: z
        .string()
        .min(1)
        .describe("The id of a workspace video file (e.g. from renderVideo)."),
      time: z
        .number()
        .min(0)
        .max(3600)
        .optional()
        .describe(
          "Timestamp in seconds into the video (e.g. 12 for 'at 0:12').",
        ),
      times: z.array(z.number().min(0).max(3600)).min(1).max(MAX_CONTACT_SHEET_FRAMES).optional()
        .describe("Batch timestamps in seconds; returns one numbered contact sheet. Do not also pass time."),
    }).refine((input) => (input.time != null) !== (input.times != null), "Pass either time or times, not both."),
    execute: async ({ fileId, time, times }: { fileId: string; time?: number; times?: number[] }, { abortSignal }: { abortSignal?: AbortSignal }): Promise<VideoFrameOutput> => {
      const inputSummary = summarizeValue({ fileId, time, times });

      try {
        if ((time != null) === (times != null)) throw new Error("Pass either time or times, not both.");
        const requested = times ?? [time!];
        if (!requested.length || requested.length > MAX_CONTACT_SHEET_FRAMES || requested.some((t) => !Number.isFinite(t) || t < 0 || t > 3600)) {
          throw new Error("Provide 1–12 finite timestamps between 0 and 3600 seconds.");
        }
        const record = await repository.getById(fileId);
        if (!record) {
          throw new Error(`No workspace file found with id ${fileId}.`);
        }
        const source = resolveWorkspaceFile(record.relativePath);
        if (!source.exists) {
          throw new Error(
            `"${record.displayName}" is no longer available locally.`,
          );
        }

        const baseName = record.displayName.replace(/\.[a-z0-9]+$/i, "");
        if (times) {
          const timestamps = [...new Set(times)].sort((a, b) => a - b);
          const frames: ScenePreviewFrame[] = [];
          // Keep decoding bounded: one thumbnail at a time, one model response
          // for the whole batch. Never allocate twelve native full-size bitmaps.
          for (const timestamp of timestamps) {
            abortSignal?.throwIfAborted();
            const thumb = await getThumbnailAsync(source.uri, { time: Math.round(timestamp * 1000), quality: 0.8 });
            const file = new File(thumb.uri);
            try {
              frames.push({ time: timestamp, width: thumb.width, height: thumb.height, base64: await file.base64() });
            } finally {
              try { file.delete(); } catch { /* Best-effort cache cleanup. */ }
            }
          }
          const sheet = await createContactSheet(frames, abortSignal);
          const binary = atob(sheet.base64);
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const saved = await workspaceService.createDocumentFile({ bytes, mimeType: "image/jpeg", name: `${baseName}-contact-sheet.jpg` });
          const text = `Contact sheet of "${record.displayName}": ${timestamps.length} frames, left-to-right, top-to-bottom (${timestamps.map((t, i) => `${i + 1}=${t}s`).join(", ")}). Saved as workspace://${saved.id}. Use time for a full-resolution closer look; thumbnails cannot verify fine details or motion.` +
            (supportsImageInput ? "" : " Your model cannot display images; use the ocr tool on the saved sheet or ask the user what they see.");
          const output: VideoFrameOutput = { text, fileId: saved.id, link: `workspace://${saved.id}`, times: timestamps, frameCount: timestamps.length, width: sheet.width, height: sheet.height, inlineImage: supportsImageInput, image: supportsImageInput ? bytes : null };
          onRecord?.(createRecord({ toolName: "getVideoFrame", status: "completed", inputSummary,
            mediaResult: { sourceFileId: record.id, sourceUpdatedAt: record.updatedAt, resultFileId: saved.id },
            preview: { title: `${record.displayName} · contact sheet`, uri: resolveWorkspaceFile(saved.relativePath).uri, mimeType: "image/jpeg" },
            outputSummary: summarizeValue({ fileId: saved.id, times: timestamps, frameCount: timestamps.length, width: sheet.width, height: sheet.height, inlineImage: supportsImageInput }),
          }));
          return output;
        }
        abortSignal?.throwIfAborted();
        const thumb = await getThumbnailAsync(source.uri, {
          time: Math.round(time! * 1000),
          quality: 0.9,
        });
        const thumbFile = new File(thumb.uri);
        const bytes = await thumbFile.bytes();
        try {
          thumbFile.delete();
        } catch {
          // Cache cleanup is best-effort.
        }

        const saved = await workspaceService.createDocumentFile({
          bytes,
          mimeType: "image/jpeg",
          name: `${baseName}-frame-${time}s.jpg`,
        });

        const text =
          `Frame at ${time}s of "${record.displayName}" ` +
          `(${thumb.width}x${thumb.height}), saved as workspace://${saved.id}. ` +
          "Describe what you see at this timestamp when replying.";

        // NOTE: execute's return value is only passed to `toModelOutput`
        // below — it is never sent to the model as-is. Without toModelOutput
        // the SDK would serialize this object (including `image` bytes) as a
        // giant JSON blob, which stalls the run. toModelOutput converts it to
        // a real vision content part instead.
        const output = {
          text: supportsImageInput
            ? text
            : `${text} Your model cannot display images, so inspect the ` +
              `saved frame with the ocr tool for on-screen text, or ask ` +
              `the user what they see at this timestamp.`,
          fileId: saved.id,
          link: `workspace://${saved.id}`,
          time,
          width: thumb.width,
          height: thumb.height,
          inlineImage: supportsImageInput,
          image: supportsImageInput ? bytes : null,
        };

        onRecord?.(
          createRecord({
            toolName: "getVideoFrame",
            status: "completed",
            inputSummary,
            mediaResult: { sourceFileId: record.id, sourceUpdatedAt: record.updatedAt, resultFileId: saved.id },
            preview: { title: `${record.displayName} · ${time}s`, uri: resolveWorkspaceFile(saved.relativePath).uri, mimeType: "image/jpeg" },
            outputSummary: summarizeValue({
              fileId: saved.id,
              link: `workspace://${saved.id}`,
              time,
              width: thumb.width,
              height: thumb.height,
              inlineImage: supportsImageInput,
            }),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "getVideoFrame",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
    toModelOutput: ({ output }: { output: VideoFrameOutput }) => {
      if (output.image) {
        return {
          type: "content",
          value: [
            { type: "text", text: output.text },
            {
              type: "file",
              data: { type: "data", data: output.image },
              mediaType: "image/jpeg",
            },
          ],
        };
      }
      return { type: "text", value: output.text };
    },
  });
}
