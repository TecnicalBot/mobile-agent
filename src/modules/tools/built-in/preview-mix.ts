import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import { readContractDuration } from "@/modules/preview/video-audio";
import {
  inlineAudioAssets,
  inlineImageAssets,
  inlineVideoAssets,
} from "@/modules/preview/video-assets";
import { requestMixCheck, type MixCheckStats } from "@/modules/preview/video-mix";
import {
  createRecord,
  summarizeValue,
} from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { resolveHtml } from "@/modules/tools/built-in/render-video";

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatRange(range: { start: number; end: number }) {
  return `${range.start}s–${range.end}s`;
}

/**
 * A compact, readable preview for the trace row. The raw tool result is a
 * list of numbers; showing the verdict and the three levels that matter keeps
 * the collapsed detail useful without expanding every range array.
 */
export function formatMixPreview(output: {
  clipped: boolean;
  duration: number;
  peak: number | null;
  rms: number | null;
  warning: string | null;
}) {
  const level = (value: number | null) =>
    value === null ? "unknown" : String(value);
  return [
    `Duration: ${output.duration}s`,
    `Peak: ${level(output.peak)}`,
    `RMS: ${level(output.rms)}`,
    `Clipping: ${output.clipped ? "yes" : "no"}`,
    output.warning ? `\n${output.warning}` : "\nNo clipping detected.",
  ].join("\n");
}

/**
 * Turns mix numbers into the single actionable verdict. Pure (no native
 * imports) for unit tests; the numbers come from the offline render.
 */
export function buildMixWarning(
  stats: MixCheckStats | null,
  hostWarnings: string[],
): string | null {
  if (!stats) {
    return hostWarnings.length > 0 ? hostWarnings.join(" ") : null;
  }
  if (stats.clipped) {
    const spots = stats.clippedRanges.map(formatRange).join(", ");
    return (
      `Mix clips${spots ? ` at ${spots}` : ""} (peak ${round3(stats.peak)}). ` +
      "Lower music volumes (e.g. music to ~0.35), deepen ducking under voice, or trim overlapping loud cues — then re-check."
    );
  }
  if (stats.peak < 0.02) {
    return (
      `Almost no audible audio (peak ${round3(stats.peak)}). ` +
      "Check track volumes, starts, and durations before rendering silence."
    );
  }
  return null;
}

/**
 * Checks a scene's audio mix without spending render time on it. Use this
 * after authoring the `audio` schedule (music, narration, ducking, effects)
 * and before calling `renderVideo`: it renders the schedule offline in a
 * hidden host and reports peak/RMS levels, clipping spots, near-silent
 * ranges, and applied ducking, so volumes and duck ranges can be fixed while
 * iteration is cheap. Numbers only — it cannot judge taste (a weak kick or
 * an ugly reverb still needs ears).
 */
export function createPreviewMixTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  const workspaceService = createWorkspaceFileService(repository);
  return tool({
    description:
      "Check a video scene's audio mix before rendering it. Use this after writing the audio schedule (music, narration, ducking, effects) and before renderVideo: it renders the mix offline and reports peak/RMS levels, clipping spots with timestamps, near-silent ranges, and applied ducking, plus one actionable warning (or null when the mix is healthy). Fix volumes or duck ranges and re-check — seconds per iteration instead of a full render each time. Pass the same HTML (or scene fileId) and duration you would render.",
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
    }),
    execute: async ({ html, fileId, duration }, { abortSignal }) => {
      const inputSummary = summarizeValue({
        hasHtml: Boolean(html),
        fileId: fileId ?? null,
        duration: duration ?? null,
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
            `The scene contract duration (${contractDuration} s) does not match the requested duration (${duration} s). Fix the contract's duration field and retry — checking now would check the wrong scene.`,
          );
        }
        const videoDuration = duration ?? contractDuration;
        if (!(videoDuration != null && videoDuration > 0)) {
          throw new Error(
            "Cannot check this mix: pass `duration` (1–45 s) matching the contract's duration field.",
          );
        }

        // Every asset inlines exactly as for export, minus the native caches
        // (seek proxies, WAV soundtrack) that only change render speed.
        const { html: audioHtml } = await inlineAudioAssets(rawHtml, repository, "preview");
        const { html: imageHtml } = await inlineImageAssets(audioHtml, repository);
        const { html: sceneHtml, warnings: clipWarnings } = await inlineVideoAssets(
          imageHtml,
          repository,
          "preview",
        );

        const check = await requestMixCheck(sceneHtml, {
          duration: videoDuration,
          signal: abortSignal,
        });
        const stats = check.stats;
        const output = {
          peak: stats ? round3(stats.peak) : null,
          rms: stats ? round3(stats.rms) : null,
          clipped: stats?.clipped ?? false,
          clippedRanges: stats?.clippedRanges ?? [],
          quietRanges: stats?.quietRanges ?? [],
          duckedRanges: stats?.duckedRanges ?? [],
          duration: videoDuration,
          warnings: [...clipWarnings, ...check.warnings],
          warning: buildMixWarning(stats, [...clipWarnings, ...check.warnings]),
        };

        const scene = fileId
          ? await repository.getById(fileId).catch(() => null)
          : null;

        onRecord?.(
          createRecord({
            toolName: "previewMix",
            status: "completed",
            inputSummary,
            preview: {
              title: scene?.displayName ?? "audio mix",
              text: formatMixPreview(output),
            },
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "previewMix",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
  });
}
