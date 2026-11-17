import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionOptions,
} from "expo-speech-recognition";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import {
  loadActiveVoiceLanguage,
  loadVoiceEngine,
} from "@/modules/voice/models";
import {
  startLocalVoiceSession,
  type LocalVoiceSession,
} from "@/modules/voice/local-session";
import { setVoiceInputActive } from "@/modules/notifications/voice-input-state";

const HISTORY_LENGTH = 48;

/**
 * Native recognizers end their own session well before a user is done talking:
 * iOS limits each request, and Android's segmented session can wrap up on
 * service restarts. Restarting immediately after `end` (with the transcript
 * kept in JS) turns those limits into a continuous dictation.
 */
const RESTART_DELAY_MS = 250;
/** Sessions shorter than this ended for a reason (mic/service failure). */
const INSTANT_END_MS = 1500;
/** Stop retrying once the recognizer keeps failing immediately. */
const MAX_INSTANT_ENDS = 3;

/** Errors that a restart cannot recover from. */
const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
]);

const SYSTEM_RECOGNITION_OPTIONS: ExpoSpeechRecognitionOptions = {
  addsPunctuation: true,
  continuous: true,
  interimResults: true,
  maxAlternatives: 1,
  volumeChangeEventOptions: {
    enabled: true,
    intervalMillis: 90,
  },
};

export type VoiceInputStatus = "idle" | "starting" | "listening" | "processing";

function normalizeLevel(value: number) {
  // The native volumechange event ranges from -2 (inaudible) to 10 (loud).
  const normalized = (value + 2) / 12;
  return Math.min(1, Math.max(0, normalized));
}

/**
 * Drives the native speech recognizer for the chat composer.
 *
 * `onFinal` receives the consolidated transcript (either because `finish()`
 * was called or because the recognizer could not recover). `onCancel` fires
 * when the user aborts or recognition ends without any usable text.
 */
export function useVoiceInput({
  onFinal,
  onCancel,
}: {
  onFinal: (transcript: string) => void;
  onCancel: () => void;
}) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [levels, setLevels] = useState<number[]>([]);

  const transcriptRef = useRef("");
  const committedRef = useRef("");
  const activeRef = useRef(false);
  const finishedRef = useRef(false);
  const errorShownRef = useRef(false);
  const startingRef = useRef(false);
  const localRef = useRef<LocalVoiceSession | null>(null);
  const localModeRef = useRef(false);
  const generationRef = useRef(0);
  const processingRef = useRef(false);
  const fatalErrorRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartedAtRef = useRef(0);
  const instantEndsRef = useRef(0);

  const onFinalRef = useRef(onFinal);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onFinalRef.current = onFinal;
    onCancelRef.current = onCancel;
  }, [onCancel, onFinal]);

  // Announcements consult this before speaking so they never play into the
  // open microphone.
  useEffect(() => {
    setVoiceInputActive(active);
    return () => {
      setVoiceInputActive(false);
    };
  }, [active]);

  const commit = useCallback(() => {
    if (!activeRef.current || finishedRef.current) {
      return;
    }

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    finishedRef.current = true;
    activeRef.current = false;
    fatalErrorRef.current = false;
    lastErrorRef.current = null;
    sessionStartedAtRef.current = 0;
    instantEndsRef.current = 0;
    setActive(false);
    setStatus("idle");

    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    committedRef.current = "";
    setTranscript("");
    setLevels([]);

    if (text) {
      onFinalRef.current(text);
    } else {
      onCancelRef.current();
    }
  }, []);

  const stop = useCallback(() => {
    if (!activeRef.current || startingRef.current || processingRef.current) {
      return;
    }

    processingRef.current = true;
    setStatus("processing");
    if (localModeRef.current) {
      const session = localRef.current;
      const generation = generationRef.current;
      if (!session) return;
      session
        .finish()
        .then((text) => {
          if (generation !== generationRef.current) return;
          transcriptRef.current = text;
          commit();
        })
        .catch((error: unknown) => {
          if (generation !== generationRef.current) return;
          Alert.alert(
            "Transcription failed",
            error instanceof Error ? error.message : String(error),
          );
          commit();
        })
        .finally(() => {
          if (localRef.current === session) localRef.current = null;
        });
      return;
    }
    // Between sessions there is no native request to stop, so no `end` event
    // would ever arrive to finish the commit.
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
      commit();
      return;
    }
    ExpoSpeechRecognitionModule.stop();
  }, [commit]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const restart = useCallback(() => {
    if (!activeRef.current || finishedRef.current || localModeRef.current) {
      return;
    }

    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    const generation = generationRef.current;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (
        !activeRef.current ||
        finishedRef.current ||
        generation !== generationRef.current
      ) {
        return;
      }
      try {
        ExpoSpeechRecognitionModule.start(SYSTEM_RECOGNITION_OPTIONS);
      } catch {
        commit();
      }
    }, RESTART_DELAY_MS);
  }, [commit]);

  const restartRef = useRef(restart);
  restartRef.current = restart;

  const cancel = useCallback(() => {
    if (!activeRef.current) {
      return;
    }

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    finishedRef.current = true;
    generationRef.current++;
    activeRef.current = false;
    fatalErrorRef.current = false;
    lastErrorRef.current = null;
    sessionStartedAtRef.current = 0;
    instantEndsRef.current = 0;
    setActive(false);
    setStatus("idle");
    transcriptRef.current = "";
    committedRef.current = "";
    setTranscript("");
    setLevels([]);
    if (localModeRef.current) {
      const session = localRef.current;
      session
        ?.cancel()
        .catch(console.error)
        .finally(() => {
          if (localRef.current === session) localRef.current = null;
        });
    } else {
      ExpoSpeechRecognitionModule.abort();
    }
    onCancelRef.current();
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (localModeRef.current || !activeRef.current) return;
    sessionStartedAtRef.current = Date.now();
    setStatus((current) => (current === "processing" ? current : "listening"));
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (localModeRef.current || !activeRef.current || finishedRef.current) {
      return;
    }

    const next = (event.results[0]?.transcript ?? "").trim();

    if (!next) {
      return;
    }

    // Android in continuous mode emits each finalized segment as its own final
    // result, while iOS emits one final result containing the full transcript.
    // Accumulate finals and preview the current interim right after them.
    if (event.isFinal) {
      committedRef.current = committedRef.current
        ? `${committedRef.current} ${next}`
        : next;
    }

    // A final is already included in committedRef; only interim results
    // should be appended to it for the live preview.
    const combined = event.isFinal
      ? committedRef.current
      : committedRef.current
        ? `${committedRef.current} ${next}`
        : next;

    transcriptRef.current = combined;
    setTranscript(combined);
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (localModeRef.current || !activeRef.current) return;
    const level = normalizeLevel(event.value);
    setLevels((current) => {
      if (current.length >= HISTORY_LENGTH) {
        return [...current.slice(current.length - HISTORY_LENGTH + 1), level];
      }
      return [...current, level];
    });
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (localModeRef.current || !activeRef.current) return;
    // A no-speech / timeout just means the user stayed silent, and an abort is
    // our own doing.
    if (
      event.error === "no-speech" ||
      event.error === "speech-timeout" ||
      event.error === "aborted"
    ) {
      return;
    }

    lastErrorRef.current = event.error;
    if (!FATAL_ERRORS.has(event.error)) {
      // Transient (network, service restart, mic momentarily busy): let the
      // `end` handler restart the session instead of ending the dictation.
      return;
    }

    fatalErrorRef.current = true;
    if (!errorShownRef.current) {
      errorShownRef.current = true;
      Alert.alert(
        "Voice input unavailable",
        event.error === "not-allowed"
          ? "Microphone and speech recognition access is required for voice input."
          : `Voice input failed (${event.error}).`,
      );
    }
  });

  useSpeechRecognitionEvent("end", () => {
    if (localModeRef.current || !activeRef.current || finishedRef.current) {
      return;
    }

    // `stop()` flags processing before asking the recognizer to finish, and
    // fatal errors end the request for good. Any other `end` is the native
    // recognizer wrapping up its own session mid-dictation, so keep listening.
    if (processingRef.current || fatalErrorRef.current) {
      commit();
      return;
    }

    const sessionStartedAt = sessionStartedAtRef.current;
    const lasted = sessionStartedAt ? Date.now() - sessionStartedAt : 0;
    instantEndsRef.current =
      lasted < INSTANT_END_MS ? instantEndsRef.current + 1 : 0;
    if (instantEndsRef.current >= MAX_INSTANT_ENDS) {
      // The recognizer keeps failing immediately (mic busy, service down).
      // Retrying forever would leave the composer listening to nothing.
      const error = lastErrorRef.current;
      if (error && !errorShownRef.current) {
        errorShownRef.current = true;
        Alert.alert(
          "Voice input unavailable",
          `Voice input failed (${error}).`,
        );
      }
      commit();
      return;
    }

    // The session can end before the last interim is finalized; promote the
    // live preview so those words survive the restart instead of being
    // replaced by the fresh session's transcript.
    committedRef.current = transcriptRef.current.trim();

    restartRef.current();
  });

  const start = useCallback(async () => {
    if (activeRef.current || startingRef.current || localRef.current) {
      return;
    }

    startingRef.current = true;
    const generation = ++generationRef.current;
    processingRef.current = false;
    errorShownRef.current = false;
    fatalErrorRef.current = false;
    lastErrorRef.current = null;
    sessionStartedAtRef.current = 0;
    instantEndsRef.current = 0;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setStatus("starting");

    // Dictation takes over the audio session; stop any message playback or
    // announcement that is currently speaking.
    await Speech.stop().catch(() => {});

    try {
      const engine = await loadVoiceEngine();
      if (generation !== generationRef.current) return;
      localModeRef.current = engine !== "system";
      if (engine !== "system") {
        const language = await loadActiveVoiceLanguage();
        if (generation !== generationRef.current) return;
        transcriptRef.current = "";
        committedRef.current = "";
        setTranscript("");
        setLevels([]);
        finishedRef.current = false;
        activeRef.current = true;
        setActive(true);
        const session = await startLocalVoiceSession(
          engine,
          language,
          (level) => {
            if (generation !== generationRef.current) return;
            setLevels((current) => [
              ...current.slice(-(HISTORY_LENGTH - 1)),
              level,
            ]);
          },
          () => stopRef.current(),
        );
        if (generation !== generationRef.current) {
          await session.cancel();
          return;
        }
        localRef.current = session;
        setStatus("listening");
        return;
      }
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (generation !== generationRef.current) return;

      if (!permission.granted) {
        setStatus("idle");
        Alert.alert(
          "Microphone access needed",
          "Enable microphone and speech recognition access for Mobile Agent in your device settings to use voice input.",
          [
            { style: "cancel", text: "Not now" },
            {
              onPress: () => {
                Linking.openSettings().catch(console.error);
              },
              text: "Open settings",
            },
          ],
        );
        return;
      }

      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setStatus("idle");
        Alert.alert(
          "Voice input unavailable",
          "Speech recognition is not available on this device. Install or enable the system speech recognition service and try again.",
        );
        return;
      }

      transcriptRef.current = "";
      committedRef.current = "";
      setTranscript("");
      setLevels([]);
      finishedRef.current = false;
      activeRef.current = true;
      setActive(true);

      // System uses the device's own recognizer language, like the keyboard's
      // voice button does. Only local Whisper takes an explicit language.
      ExpoSpeechRecognitionModule.start(SYSTEM_RECOGNITION_OPTIONS);
    } catch (startError) {
      if (generation !== generationRef.current) return;
      activeRef.current = false;
      setActive(false);
      setStatus("idle");
      Alert.alert(
        "Could not start voice input",
        startError instanceof Error
          ? startError.message
          : "An unexpected error occurred.",
      );
    } finally {
      startingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const generation = generationRef;
    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      activeRef.current = false;
      generation.current++;
      if (localModeRef.current) localRef.current?.cancel().catch(console.error);
      else ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  return {
    active,
    cancel,
    finish: stop,
    levels,
    start,
    status,
    transcript,
  };
}
