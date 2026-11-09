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
      "Inspect a workspace video. Pass fileId plus times (1–12 seconds-based timestamps) to capture a batch, or time for a single moment. One timestamp returns ONE full-resolution still; multiple timestamps return ONE compact, timestamp-labeled contact sheet. time and times may both be passed — they are merged, deduplicated, and sorted, so a call is never rejected just for including both. Prefer times for reviewing multiple moments: one tool call and one vision image, no separate reads needed. Non-vision models get a file link for ocr instead.",
    inputSchema: z.object({
      fileId: z
        .string()
        .min(1)
        .describe("The id of a workspace video file (e.g. from renderVideo)."),
      time: z
        .number()
        .min(0)
        .max(3600)
        .nullish()
        .describe(
          "Timestamp in seconds into the video (e.g. 12 for 'at 0:12').",
        ),
      times: z.array(z.number().min(0).max(3600)).max(MAX_CONTACT_SHEET_FRAMES).nullish()
        .describe("Batch timestamps in seconds; returns one numbered contact sheet when more than one unique timestamp is supplied. May be combined with time."),
    }),
    execute: async ({ fileId, time, times }: { fileId: string; time?: number | null; times?: number[] | null }, { abortSignal }: { abortSignal?: AbortSignal }): Promise<VideoFrameOutput> => {
      const inputSummary = summarizeValue({ fileId, time, times });

      try {
        // The JSON schema cannot express "exactly one of time/times", and
        // models/harnesses reasonably send one, the other, or both. Normalize
        // them here instead of failing schema validation before execute runs:
        // a validation failure aborts the turn, while an execute error is a
        // tool result the model can recover from.
        const requested = [
          ...new Set([...(times ?? []), ...(time != null ? [time] : [])]),
        ].sort((a, b) => a - b);
        if (requested.length === 0) {
          throw new Error(
            "Pass time or times with at least one timestamp in seconds.",
          );
        }
        if (requested.length > MAX_CONTACT_SHEET_FRAMES) {
          throw new Error(
            `Provide at most ${MAX_CONTACT_SHEET_FRAMES} timestamps per call.`,
          );
        }
        if (requested.some((t) => !Number.isFinite(t) || t < 0 || t > 3600)) {
          throw new Error(
            "Provide finite timestamps between 0 and 3600 seconds.",
          );
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
        if (requested.length > 1) {
          const timestamps = requested;
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
          const text = `Contact sheet of "${record.displayName}": ${timestamps.length} frames, left-to-right, top-to-bottom (${timestamps.map((t, i) => `${i + 1}=${t}s`).join(", ")}). Saved as workspace://${saved.id}. Use time (or a single value in times) for a full-resolution closer look; thumbnails cannot verify fine details or motion.` +
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
        // A single unique timestamp returns the full-resolution still, even
        // when the caller supplied it through `times: [t]`.
        const timestamp = requested[0]!;
        const thumb = await getThumbnailAsync(source.uri, {
          time: Math.round(timestamp * 1000),
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
          name: `${baseName}-frame-${timestamp}s.jpg`,
        });

        const text =
          `Frame at ${timestamp}s of "${record.displayName}" ` +
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
          time: timestamp,
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
            preview: { title: `${record.displayName} · ${timestamp}s`, uri: resolveWorkspaceFile(saved.relativePath).uri, mimeType: "image/jpeg" },
            outputSummary: summarizeValue({
              fileId: saved.id,
              link: `workspace://${saved.id}`,
              time: timestamp,
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
