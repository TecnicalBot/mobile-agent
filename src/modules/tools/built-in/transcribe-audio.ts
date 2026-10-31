import { File, Paths } from "expo-file-system";
import { tool } from "ai";
import { z } from "zod";

import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import {
  assertAudioFileUsable,
  buildAudioDataUri,
  MAX_AUDIO_FILE_BYTES,
  resolveAudioMimeType,
} from "@/modules/preview/video-audio";
import { requestAudioAnalysis } from "@/modules/preview/video-audio-analysis-job";
import {
  createRecord,
  summarizeValue,
} from "@/modules/tools/built-in/shared";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { saveMediaResult } from "@/modules/tools/built-in/media-result";
import { transcribePcm16 } from "@/modules/voice/transcribe";
import { transcribePcm16WithSystem } from "@/modules/voice/system-transcribe";
import type { WhisperLanguage } from "@/modules/voice/models";
import {
  hasNativeAudioDecoder,
  transcribeLongAudio,
} from "@/modules/voice/windowed-transcribe";

/**
 * Transcribes an audio file already in the workspace and returns timed text, so
 * the agent can author visuals that react to (or caption) actual spoken words.
 *
 * Two decode lanes, picked per build:
 *
 *  - Native (Android with the video-export module): the file's audio track is
 *    decoded by MediaCodec into a bounded PCM cache, transcribed in 30 s
 *    Whisper windows. Time-bounded (`maxSeconds`), not size-bounded — long
 *    recordings never touch the JS heap or the in-page decode.
 *  - Legacy (iOS / older builds): the hidden WebView host decodes ≤15 MB
 *    via WebAudio; everything bigger fails with the inline budget error.
 *
 * The engine that turns PCM into words is selectable:
 *
 *  - `whisper` (default): the bundled on-device Whisper models, available
 *    everywhere a model is downloaded and reliable about timings.
 *  - `system`: the device's own recognizer, which is a different model and
 *    occasionally more accurate; see system-transcribe.ts for its limits.
 *
 * The timings are deterministic and can be baked into the HTML, or mirrored at
 * render time (see the speech track exposed to the recorder).
 */
export function createTranscribeAudioTool({
  onProgress,
  onRecord,
  repository,
}: WorkspaceToolFactoryParams) {
  return tool({
    description:
      'Transcribe speech in an audio file already saved in the workspace and get the words with start/end times in seconds. Use this when the user wants a video, animation, or captions that follow what is said in a recording (e.g. \'make the words pop up as they are spoken\'). Returns the full `text`, a detected `language`, the transcribed `duration`, `sourceDuration` (the whole recording), `truncated` (true when `maxSeconds` cut it short), and `segments` (sentence/phrase-level spans with `start`, `end`, and `text`). Runs entirely on device with the Whisper model downloaded in Settings → Voice input; MP3, WAV, M4A, AAC, OGG, WebM, and long MP4/MOV/WebM video soundtracks are all supported — audio decodes natively in bounded windows and transcribes in 30 s slices, so the practical limit is spoken time (`maxSeconds`, up to 3600 s), not file size. When `truncated` is true, re-run with a larger `maxSeconds` to cover more of the recording. Builds without the native decoder fall back to inline decoding capped at 15 MB, as does engine: "system" — downloading a Whisper model does not raise that cap. engine: "system" uses the device\'s own recognizer (Android 13+; it reports word timings and therefore `segments` only on Android 14+ with the on-device speech model, otherwise it returns text with no timings). This only transcribes speech - it does not analyze music, so use analyzeAudio for tempo, melody, notes, and key.',
    inputSchema: z.object({
      fileId: z
        .string()
        .min(1)
        .describe(
          "The id of a workspace audio file to transcribe (MP3, WAV, M4A, AAC, OGG, WebM — or MP4/MOV/WebM video, whose soundtrack is transcribed).",
        ),
      language: z
        .string()
        .min(2)
        .max(8)
        .optional()
        .describe(
          "Spoken language code such as 'en', 'es', or 'de'. Omit to auto-detect.",
        ),
      maxSeconds: z
        .number()
        .min(1)
        .max(3600)
        .optional()
        .describe(
          "Only transcribe the first N seconds (default 90). Long recordings decode natively in bounded windows, so raising this keeps memory flat — it only bounds how much is decoded and transcribed.",
        ),
      engine: z
        .enum(["whisper", "system"])
        .optional()
        .describe(
          'Which recognizer to use. "whisper" (default) uses the downloaded on-device models and always returns timed segments. "system" uses the device\'s own recognizer (Android 13+), which is sometimes more accurate but only returns timed segments on Android 14+ with the on-device speech model.',
        ),
    }),
    execute: async ({ fileId, language, maxSeconds, engine }, { abortSignal }) => {
      const inputSummary = summarizeValue({
        fileId,
        language: language ?? null,
        maxSeconds: maxSeconds ?? null,
        engine: engine ?? "whisper",
      });

      try {
        const record = await repository.getById(fileId);
        if (!record) {
          throw new Error(`No workspace file found with id ${fileId}.`);
        }

        const file = resolveWorkspaceFile(record.relativePath);
        if (!file.exists) {
          throw new Error(
            `Audio file "${record.displayName}" is no longer available locally.`,
          );
        }

        const useSystem = engine === "system";
        const nativeAvailable = hasNativeAudioDecoder();
        const useNative = !useSystem && nativeAvailable;

        const transcript = useNative
          ? await transcribeNatively(record, file, {
              maxSeconds: maxSeconds ?? 90,
              language,
              signal: abortSignal,
              onProgress,
            })
          : await transcribeInline(
              record,
              file,
              { useSystem, nativeAvailable, language },
              {
                maxSeconds: maxSeconds ?? 90,
                signal: abortSignal,
              },
            );

        const output: Record<string, unknown> = {
          fileId: record.id,
          displayName: record.displayName,
          engine: useSystem ? "system" : "whisper",
          language: transcript.language,
          duration: transcript.duration,
          text: transcript.text,
          segmentCount: transcript.segments.length,
          segments: transcript.segments,
        };
        if (transcript.sourceDuration != null) {
          output.sourceDuration = transcript.sourceDuration;
        }
        if (transcript.truncated) {
          output.truncated = true;
        }
        const warnings: string[] = [];
        if (transcript.truncated && transcript.sourceDuration != null) {
          warnings.push(
            `Only the first ${round1(transcript.duration)} s of a ${round1(transcript.sourceDuration)} s recording were transcribed (maxSeconds ${maxSeconds ?? 90}). Re-run with a larger maxSeconds (up to 3600) to transcribe the rest.`,
          );
        }
        if (useSystem && transcript.segments.length === 0) {
          warnings.push(
            'The system recognizer did not report word timings on this device, so there are no timed `segments` (captions cannot be placed from this result). Re-run with engine "whisper" if you need timings.',
          );
        }
        if (warnings.length > 0) {
          output.warning = warnings.join(" ");
        }

        const mediaResult = await saveMediaResult(repository, record, "transcript", output);
        if (mediaResult) {
          output.resultFileId = mediaResult.resultFileId;
          output.resultLink = `workspace://${mediaResult.resultFileId}`;
        }
        onRecord?.(
          createRecord({
            toolName: "transcribeAudio",
            status: "completed",
            inputSummary,
            mediaResult,
            preview: { title: record.displayName, text: transcript.text.slice(0, 20000), truncated: transcript.text.length > 20000 },
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "transcribeAudio",
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

/**
 * Native lane: decode the soundtrack with MediaCodec into a bounded PCM
 * cache, then window-transcribe it. The cache file is owned here — deleted
 * however the run ends. Paths lose their file:// scheme: the native module
 * expects plain paths.
 */
async function transcribeNatively(
  record: { id: string },
  file: { uri: string },
  options: {
    maxSeconds: number;
    language?: string;
    signal?: AbortSignal;
    onProgress?: (progress: {
      bytesWritten: number;
      totalBytes: number;
    }) => void;
  },
) {
  const pcmFile = new File(Paths.cache, `transcribe-pcm-${record.id}`);
  try {
    return await transcribeLongAudio({
      filePath: stripScheme(file.uri),
      pcmPath: stripScheme(pcmFile.uri),
      maxSeconds: options.maxSeconds,
      language: options.language as WhisperLanguage | undefined,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } finally {
    try {
      await pcmFile.delete();
    } catch {
      // The cache directory sweeps stale files; never block the tool here.
    }
  }
}

/** Legacy lane: inline ≤15 MB through the WebAudio decode host. */
async function transcribeInline(
  record: { displayName: string; mimeType: string | null | undefined },
  file: { size?: number | null; bytes: () => Promise<Uint8Array> },
  options: {
    useSystem: boolean;
    nativeAvailable: boolean;
    language?: string;
  },
  limits: { maxSeconds: number; signal?: AbortSignal },
) {
  // Stat before reading: the data lane must reject an over-cap file on its
  // stat, never on bytes already in the heap — FileSystemFile.bytes()
  // materializes the whole file, so an oversized audio OOMs inside the read
  // before the post-read assert could reject it.
  const statSize = typeof file.size === "number" ? file.size : null;
  const budgetError = inlineBudgetError(record, statSize, options);
  if (budgetError) throw budgetError;
  assertAudioFileUsable(record.displayName, record.mimeType, statSize);
  const bytes = await file.bytes();
  const mimeType = assertAudioFileUsable(
    record.displayName,
    record.mimeType,
    bytes.length,
  );

  const { pcm, summary } = await requestAudioAnalysis({
    src: buildAudioDataUri(mimeType, bytes),
    maxSeconds: limits.maxSeconds,
    sampleRate: 16000,
    pcmSampleRate: 16000,
    signal: limits.signal,
  });
  if (!pcm) {
    throw new Error(
      "This build cannot decode audio for transcription.",
    );
  }

  const transcript = options.useSystem
    ? await transcribePcm16WithSystem(pcm.base64, pcm.sampleRate, {
        language: options.language,
        signal: limits.signal,
      })
    : await transcribePcm16(pcm.base64, pcm.sampleRate, {
        language: (options.language as WhisperLanguage | undefined) ?? "auto",
        signal: limits.signal,
      });
  const sourceDuration =
    typeof summary.sourceDuration === "number"
      ? summary.sourceDuration
      : null;
  return {
    ...transcript,
    sourceDuration: sourceDuration ?? undefined,
    truncated:
      sourceDuration != null && sourceDuration - limits.maxSeconds > 0.5,
  };
}

/**
 * The inline lane's 15 MB cap is a decode-buffer limit, not a Whisper limit,
 * so the stock "keep files under 15 MB" message sent users (and the agent)
 * chasing a model download that cannot help. Name the actual cause instead.
 */
function inlineBudgetError(
  record: { displayName: string; mimeType: string | null | undefined },
  sizeBytes: number | null,
  options: { useSystem: boolean; nativeAvailable: boolean },
): Error | null {
  if (sizeBytes == null || sizeBytes <= MAX_AUDIO_FILE_BYTES) return null;
  // Leave format/empty failures to assertAudioFileUsable, which names them.
  if (!resolveAudioMimeType(record.mimeType, record.displayName)) return null;
  const size = round1(sizeBytes / (1024 * 1024));
  const cap = round1(MAX_AUDIO_FILE_BYTES / (1024 * 1024));
  if (options.useSystem) {
    return new Error(
      `Audio file "${record.displayName}" is too large (${size} MB) for the system recognizer, which decodes inline and is capped at ${cap} MB. Re-run with engine "whisper" so the native decoder can stream it, or provide a file under ${cap} MB.`,
    );
  }
  if (!options.nativeAvailable) {
    return new Error(
      `Audio file "${record.displayName}" is too large (${size} MB) for this build's inline decoder, which is capped at ${cap} MB. This build does not include the native audio decoder, so long recordings cannot be transcribed here — installing a Whisper model does not raise this cap. Install a build that includes the native decoder, or provide a file under ${cap} MB.`,
    );
  }
  return null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function stripScheme(uri: string) {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}
