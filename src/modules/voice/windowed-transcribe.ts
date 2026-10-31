import { Platform } from "react-native";

import { getHtmlVideoExportModule } from "html-video-export";

import {
  decodePcm16Base64,
  type Transcript,
  type TranscriptSegment,
} from "@/modules/voice/transcribe";
import { floatToPcm16, prepareWhisperAudio } from "@/modules/voice/pcm";
import {
  isModelDownloaded,
  modelFile,
  resolveTranscriptionModel,
  type WhisperLanguage,
} from "@/modules/voice/models";

export type LongTranscribeOptions = {
  /** Plain filesystem path of the source file (no file:// scheme). */
  filePath: string;
  /** Plain filesystem path the decoded PCM cache will be written to. */
  pcmPath: string;
  /** Transcribe the first N seconds (also bounds native decode). */
  maxSeconds: number;
  language?: WhisperLanguage;
  signal?: AbortSignal;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
};

/** whisper.cpp reports segment times in centiseconds (10 ms units). */
type WhisperWindowResult = {
  result?: string;
  language?: string;
  isAborted?: boolean;
  segments?: { text: string; t0: number; t1: number }[];
};

/** whisper.cpp processes audio in 30 s chunks; windows match for parity. */
export const WINDOW_SECONDS = 30;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * True when this build can decode long audio natively (Android with the
 * video-export module present). Everything else — including the "system"
 * engine, which needs 16 kHz PCM — falls back to the data-URI decode lane
 * where the 15 MB budget keeps applying.
 */
export function hasNativeAudioDecoder(): boolean {
  if (Platform.OS !== "android") return false;
  const module = getHtmlVideoExportModule();
  return (
    typeof module?.decodeAudioPcm === "function" &&
    typeof module?.readPcmSegment === "function"
  );
}

/**
 * Long-recording transcription lane.
 *
 * The film is decoded natively once (`maxSeconds`-bounded: RAM and decode
 * time never scale with the source file), then a shared Whisper context is
 * fed consecutive 30 s windows — whisper.cpp's own native chunk size. The
 * previous window's final words seed the next window as a prompt
 * (whisper.rn's documented slice pattern) so seams stay continuous, and the
 * last consistently-detected language is locked so auto-detect cannot
 * flip-flop across windows. Every window's segments are offset back onto
 * the whole-file timeline.
 *
 * The caller owns the PCM cache file and deletes it; this function treats
 * it as pure staging. All failures are event-driven: decode errors reject,
 * abort stops the running whisper task, silence keeps nothing pending.
 */
export async function transcribeLongAudio(
  options: LongTranscribeOptions,
): Promise<Transcript & { sourceDuration: number; truncated: boolean }> {
  const module = getHtmlVideoExportModule();
  if (!module?.decodeAudioPcm || !module.readPcmSegment) {
    throw new Error("The native audio decoder is not available in this build.");
  }

  const model = await resolveTranscriptionModel();
  if (!model) {
    throw new Error(
      "No Whisper model is available. Download one in Settings → Voice input, then try again.",
    );
  }
  if (!isModelDownloaded(model)) {
    throw new Error(
      "The selected Whisper model is missing. Download it in Settings → Voice input.",
    );
  }
  const whisper = await import("whisper.rn/index").catch(() => null);
  if (!whisper) {
    throw new Error(
      "On-device transcription is not available in this build.",
    );
  }
  const context = await whisper.initWhisper({
    filePath: modelFile(model).uri,
    useGpu: false,
  });

  const segments: TranscriptSegment[] = [];
  const texts: string[] = [];
  let lockedLanguage: string | null =
    options.language && options.language !== "auto" ? options.language : null;
  let windowIndex = 0;
  let decoded: {
    pcmPath: string;
    bytes: number;
    sampleRate: number;
    channels: number;
    durationSeconds: number;
  };
  let cancelled = false;
  let activeTask: {
    stop: () => Promise<void>;
    promise: Promise<WhisperWindowResult>;
  } | null = null;
  const onAbort = () => {
    cancelled = true;
    activeTask?.stop().catch(() => {});
  };
  options.signal?.addEventListener("abort", onAbort);

  try {
    // Bounded decode: MediaCodec never feeds input past maxSeconds, so both
    // RAM and decode time stay flat regardless of source length.
    decoded = await module.decodeAudioPcm(
      options.filePath,
      options.pcmPath,
      Math.max(1, Math.min(options.maxSeconds, 3600)),
    );
    const perSampleBytes = decoded.sampleRate * decoded.channels * 2;
    const windowBytes = WINDOW_SECONDS * perSampleBytes;
    const windowCount = Math.max(1, Math.ceil(decoded.bytes / windowBytes));

    const reportProgress = () => {
      options.onProgress?.({
        bytesWritten: Math.min(
          100,
          Math.round((windowIndex / windowCount) * 100),
        ),
        totalBytes: 100,
      });
    };

    reportProgress();
    let byteOffset = 0;
    while (!cancelled && byteOffset < decoded.bytes) {
      const segment = await module.readPcmSegment(decoded.pcmPath, byteOffset, windowBytes);
      if (segment.bytes <= 0 || !segment.base64) break;
      byteOffset += segment.bytes;

      // Same conversion chain as the single-shot lane (transcribe.ts): the
      // interleave → mono mixdown and resample happen in the tested
      // prepareWhisperAudio; only the container differs (native decoder).
      const int16 = decodePcm16Base64(segment.base64);
      if (int16.length === 0) continue;
      const floats = new Float32Array(int16.length);
      for (let index = 0; index < int16.length; index += 1) {
        floats[index] = int16[index] / 32768;
      }
      const mono = prepareWhisperAudio([floats], decoded.sampleRate, decoded.channels);
      if (mono.length === 0) continue;
      const pcm = floatToPcm16(mono);

      const windowStart = windowIndex * WINDOW_SECONDS;
      const windowSeconds = segment.bytes / perSampleBytes;
      const promptTail = texts
        .join(" ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(-6)
        .join(" ");

      activeTask = context.transcribeData(pcm.buffer as ArrayBuffer, {
        language: lockedLanguage ?? options.language ?? "auto",
        // Greedy decoding hallucinates on short/ambiguous clips; matches
        // the voice-input path's beam settings.
        beamSize: 5,
        bestOf: 5,
        temperature: 0,
        temperatureInc: 0.2,
        ...(promptTail ? { prompt: promptTail } : {}),
      }) as { stop: () => Promise<void>; promise: Promise<WhisperWindowResult> };
      const windowResult: WhisperWindowResult = await activeTask.promise;
      activeTask = null;
      if (cancelled) {
        throw new Error("Transcription was cancelled.");
      }

      // whisper.cpp reports segment times in centiseconds (10 ms units),
      // relative to the window; clamp to the window's real extent so a
      // hallucinated tail cannot spill across the next window's timeline.
      const windowSegments: TranscriptSegment[] = (windowResult.segments ?? [])
        .map((entry) => ({
          start: round2(windowStart + (entry.t0 ?? 0) / 100),
          end: round2(
            windowStart + Math.min(entry.t1 ?? 0, windowSeconds * 100) / 100,
          ),
          text: (entry.text ?? "").trim(),
        }))
        .filter((entry) => entry.text.length > 0);
      if (windowSegments.length > 0) {
        segments.push(...windowSegments);
      }
      if (windowResult.result?.trim()) {
        texts.push(windowResult.result.trim());
        if (!lockedLanguage) {
          lockedLanguage = windowResult.language || options.language || "auto";
        }
      }
      windowIndex += 1;
      reportProgress();
    }
    if (cancelled) {
      throw new Error("Transcription was cancelled.");
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    await context.release();
  }

  // The decoder reports the whole track's duration even though it only
  // decoded `maxSeconds` of it, so callers can tell a complete transcript
  // from a truncated one. This is the one place long audio gets clipped, and
  // staying silent about it made the tool look broken for long recordings.
  const sourceDuration = round2(decoded.durationSeconds);
  return {
    text: texts.join(" ").trim(),
    language: lockedLanguage ?? options.language ?? "auto",
    duration: round2(Math.min(options.maxSeconds, decoded.durationSeconds)),
    segments,
    sourceDuration,
    truncated: sourceDuration - options.maxSeconds > 0.5,
  };
}
