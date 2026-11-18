import { tool } from "ai";
import { z } from "zod";

import {
  createRecord,
  summarizeValue,
} from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { getLocalTtsModule } from "local-tts";

/**
 * Lists the on-device text-to-speech voices installed for narration, so the
 * agent can pick a real `language` for the `textToSpeech` tool instead of
 * guessing — or fall back to the network endpoint when nothing fits.
 */
export function createListVoicesTool({
  onRecord,
}: WorkspaceToolFactoryParams) {
  return tool({
    description:
      "List the text-to-speech voices installed on this device for narration. Use this before textToSpeech when the user wants a specific language or voice — it shows every installed voice with its BCP-47 locale (e.g. 'en-US'), quality, and whether it needs network. Pass `language` (e.g. 'en', 'es') to filter to matching voices. When the needed language is missing entirely, install it in the system text-to-speech settings or use the network TTS endpoint documented in the html-video skill. Android only.",
    inputSchema: z.object({
      language: z
        .string()
        .min(2)
        .max(12)
        .optional()
        .describe(
          "Only return voices whose locale starts with this BCP-47 code, e.g. 'en' or 'es'. Omit for all voices.",
        ),
    }),
    execute: async ({ language }) => {
      const inputSummary = summarizeValue({ language: language ?? null });

      try {
        const module = getLocalTtsModule();
        if (!module) {
          throw new Error(
            "Voice listing needs an Android build with the local TTS module.",
          );
        }
        const prefix = (language ?? "").trim().toLowerCase();
        const voices = (await module.getVoices())
          .filter((voice) =>
            prefix ? voice.locale.toLowerCase().startsWith(prefix) : true,
          )
          .map((voice) => ({
            locale: voice.locale,
            name: voice.name,
            quality: voice.quality,
            latency: voice.latency,
            networkRequired: voice.networkRequired,
          }));
        const output = {
          count: voices.length,
          languages: [...new Set(voices.map((voice) => voice.locale))].sort(),
          voices,
        };

        onRecord?.(
          createRecord({
            toolName: "listVoices",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          outputData: output,
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "listVoices",
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
