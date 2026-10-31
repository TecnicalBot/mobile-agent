import { tool } from "ai";
import { z } from "zod";

import { createWorkspaceFileService } from "@/core/services/workspace-file-service";
import {
  createRecord,
  summarizeValue,
} from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { synthesizeNarrationParts } from "@/modules/voice/local-tts";

/**
 * Speaks a narration script with the device's on-device text-to-speech
 * voices and saves it as workspace audio for videos — no network, no
 * third-party endpoint.
 *
 * Long scripts are split at sentence boundaries into numbered WAV parts with
 * back-to-back `start` offsets. Schedule each part as a `file:` track at its
 * `start` so the full narration plays in order, then run `transcribeAudio`
 * on the parts and drive captions from the `speech` contract.
 */
export function createTextToSpeechTool({
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  return tool({
    description:
      "Speak a narration script out loud with the device's on-device voices and save it as workspace audio for a video voiceover. Use this when the user wants narration or a voiceover and there is no suitable audio file in the workspace — it works fully offline on Android with the system's installed voices, in any language the device supports (pass a BCP-47 code like 'en', 'es', 'hi', or 'ta'; omit for the device default). Long scripts are split into numbered WAV parts; the result lists each part's `fileId`/`link` with a back-to-back `start` offset in seconds and the `totalDuration`. Schedule every part as a `file:` audio track at its `start`, then run transcribeAudio on the parts to get phrase-level timed `segments` for captions. Fails clearly when the requested voice is missing — install it in the system text-to-speech settings or pick an installed language. For over 6000 characters of text, split the script yourself across calls.",
    inputSchema: z.object({
      text: z
        .string()
        .min(1)
        .max(6000)
        .describe(
          "The narration script to speak (plain sentences, no markup).",
        ),
      language: z
        .string()
        .min(2)
        .max(12)
        .optional()
        .describe(
          "BCP-47 language code such as 'en', 'es', 'de', 'hi', or 'ta'. Omit for the device default voice.",
        ),
      rate: z
        .number()
        .min(0.25)
        .max(4)
        .optional()
        .describe("Speaking rate multiplier (default 1)."),
      pitch: z
        .number()
        .min(0.25)
        .max(4)
        .optional()
        .describe("Voice pitch multiplier (default 1)."),
      name: z
        .string()
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Base file name for the saved audio (default 'narration').",
        ),
    }),
    execute: async ({ text, language, rate, pitch, name }, { abortSignal }) => {
      const inputSummary = summarizeValue({
        chars: text.length,
        language: language ?? null,
        rate: rate ?? null,
        pitch: pitch ?? null,
        name: name ?? null,
      });

      try {
        const workspaceService = createWorkspaceFileService(repository);
        const narration = await synthesizeNarrationParts(text, {
          language,
          rate,
          pitch,
          name,
          workspaceService,
          signal: abortSignal,
        });

        const output = {
          partCount: narration.parts.length,
          parts: narration.parts,
          totalDuration: narration.totalDuration,
          language: narration.language,
        };

        onRecord?.(
          createRecord({
            toolName: "textToSpeech",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "textToSpeech",
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
