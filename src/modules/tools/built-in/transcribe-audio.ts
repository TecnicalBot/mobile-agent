import { File, Paths } from "expo-file-system";
import { tool } from "ai";
import { z } from "zod";

import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import {
  assertAudioFileUsable,
  buildAudioDataUri,
  MAX_AUDIO_FILE_BYTES,
  MAX_SERVED_AUDIO_FILE_BYTES,
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
 *  - Inline (iOS / older builds, and the `system` engine): the hidden WebView
 *    host decodes the file over the loopback asset server (≤200 MB, no heap
 *    copy), the same lane `analyzeAudio` uses. Only when that server is
 *    unavailable does the file become a data URI, capped at 15 MB.
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
      'Transcribe speech in an audio file already saved in the workspace and get the words with start/end times in seconds. Use this when the user wants a video, animation, or captions that follow what is said in a recording (e.g. \'make the words pop up as they are spoken\'). Returns the full `text`, a detected `language`, the transcribed `duration`, `sourceDuration` (the whole recording), `truncated` (true when `maxSeconds` cut it short), and `segments` (sentence/phrase-level spans with `start`, `end`, and `text`). Runs entirely on device with the Whisper model downloaded in Settings → Voice input; MP3, WAV, M4A, AAC, OGG, WebM, and long MP4/MOV/WebM video soundtracks are all supported — audio decodes natively in bounded windows and transcribes in 30 s slices, so the practical limit is spoken time (`maxSeconds`, up to 3600 s), not file size. When `truncated` is true, re-run with a larger `maxSeconds` to cover more of the recording. Builds without the native decoder — and engine: "system" — decode through the hidden WebView host over loopback HTTP (files up to 200 MB, no size inflation); only when the loopback server is unavailable does a data-URI fallback cap the file at 15 MB. engine: "system" uses the device\'s own recognizer (Android 13+; it reports word timings and therefore `segments` only on Android 14+ with the on-device speech model, otherwise it returns text with no timings). This only transcribes speech - it does not analyze music, so use analyzeAudio for tempo, melody, notes, and key.',
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
          'Which recognizer to use. "whisper" (default) uses the downloaded on-device models and normally returns timed segments; if a model returns text without segment timings, the result includes a warning. "system" uses the device\'s own recognizer (Android 13+), which is sometimes more accurate but only returns timed segments on Android 14+ with the on-device speech model.',
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
        if (
          !useSystem &&
          transcript.text.trim() &&
          transcript.segments.length === 0
        ) {
          warnings.push(
            "Whisper returned text but no timed `segments` for this file, so captions cannot be placed from this result. Try a clearer recording or a different Whisper model; the plain `text` is still usable.",
          );
        }

        // Warnings and timings come before the full text on purpose. Tool-result
        // consumers (including OpenCode's MCP bridge) can truncate large JSON
        // payloads; keeping `segments` early means captions survive that
        // truncation. The saved JSON and trace preview also show timings
        // directly instead of making the agent infer them from plain text.
        const output: Record<string, unknown> = {
          fileId: record.id,
          displayName: record.displayName,
          engine: useSystem ? "system" : "whisper",
          language: transcript.language,
          duration: transcript.duration,
          ...(transcript.sourceDuration != null
            ? { sourceDuration: transcript.sourceDuration }
            : {}),
          ...(transcript.truncated ? { truncated: true } : {}),
          ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
          segmentCount: transcript.segments.length,
          segments: transcript.segments,
          text: transcript.text,
        };

        const previewText = formatTranscriptPreview(transcript);
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
            preview: {
              title: record.displayName,
              text: previewText.slice(0, 20000),
              truncated: previewText.length > 20000,
            },
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

/**
 * Inline lane: the WebView decode host. Prefer the loopback asset server
 * (streams from disk, up to MAX_SERVED_AUDIO_FILE_BYTES) exactly like
 * `analyzeAudio`; the ≤15 MB data-URI lane is only the no-server fallback.
 */
async function transcribeInline(
  record: {
    displayName: string;
    mimeType: string | null | undefined;
    relativePath: string;
  },
  file: { size?: number | null; bytes: () => Promise<Uint8Array> },
  options: {
    useSystem: boolean;
    nativeAvailable: boolean;
    language?: string;
  },
  limits: { maxSeconds: number; signal?: AbortSignal },
) {
  const statSize = typeof file.size === "number" ? file.size : null;

  // Served lane first: stat-only validation, and the host fetches the file
  // over loopback HTTP, so a long video's soundtrack never enters the JS heap.
  const { ensureAssetServer, workspaceFileUrl } = await import(
    "@/modules/preview/asset-server"
  );
  const baseUrl = await ensureAssetServer().catch(() => null);
  let src: string;
  if (baseUrl) {
    assertAudioFileUsable(
      record.displayName,
      record.mimeType,
      statSize,
      MAX_SERVED_AUDIO_FILE_BYTES,
    );
    src = workspaceFileUrl(baseUrl, record.relativePath);
  } else {
    // Stat before reading: the data lane must reject an over-cap file on its
    // stat, never on bytes already in the heap — FileSystemFile.bytes()
    // materializes the whole file, so an oversized audio OOMs inside the read
    // before the post-read assert could reject it.
    const budgetError = inlineBudgetError(record, statSize, options);
    if (budgetError) throw budgetError;
    assertAudioFileUsable(record.displayName, record.mimeType, statSize);
    const bytes = await file.bytes();
    const mimeType = assertAudioFileUsable(
      record.displayName,
      record.mimeType,
      bytes.length,
    );
    src = buildAudioDataUri(mimeType, bytes);
  }

  const { pcm, summary } = await requestAudioAnalysis({
    src,
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
 * The data-URI fallback's 15 MB cap is a heap budget (base64-inflated document
 * plus decode buffer), not a Whisper limit. The served lane never reaches this
 * check; when it does run, name the real cause instead of sending users (and
 * the agent) chasing a model download that cannot help.
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
  if (options.useSystem && options.nativeAvailable) {
    return new Error(
      `Audio file "${record.displayName}" is too large (${size} MB) for the system recognizer on this build, which has to use the ${cap} MB data-URI fallback because the loopback server is unavailable. Re-run with engine "whisper" so the native decoder can stream it, or provide a file under ${cap} MB.`,
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

/** Keep the captured trace/transcript readable and visibly timed. */
export function formatTranscriptPreview(transcript: {
  text: string;
  segments: { start: number; end: number; text: string }[];
}) {
  if (transcript.segments.length === 0) return transcript.text;
  return transcript.segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)} → ${formatTimestamp(segment.end)}] ${segment.text}`,
    )
    .join("\n");
}

function formatTimestamp(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) return `${safe.toFixed(2)}s`;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function stripScheme(uri: string) {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}
