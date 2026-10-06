import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking } from "react-native";

const RECOGNITION_LANG = "en-US";

const HISTORY_LENGTH = 48;

export type VoiceInputStatus =
  | "idle"
  | "starting"
  | "listening"
  | "processing";

function normalizeLevel(value: number) {
  // The native volumechange event ranges from -2 (inaudible) to 10 (loud).
  const normalized = (value + 2) / 12;
  return Math.min(1, Math.max(0, normalized));
}

/**
 * Drives the native speech recognizer for the chat composer.
 *
 * `onFinal` receives the consolidated transcript once the recognizer returns a
 * final result (either because it auto-stopped or because `finish()` was
 * called). `onCancel` fires when the user aborts or recognition ends without
 * any usable text.
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

  const onFinalRef = useRef(onFinal);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onFinalRef.current = onFinal;
    onCancelRef.current = onCancel;
  }, [onCancel, onFinal]);

  const commit = useCallback(() => {
    if (!activeRef.current || finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    activeRef.current = false;
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
    if (!activeRef.current) {
      return;
    }

    setStatus("processing");
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const cancel = useCallback(() => {
    if (!activeRef.current) {
      return;
    }

    finishedRef.current = true;
    activeRef.current = false;
    setActive(false);
    setStatus("idle");
    transcriptRef.current = "";
    committedRef.current = "";
    setTranscript("");
    setLevels([]);
    ExpoSpeechRecognitionModule.abort();
    onCancelRef.current();
  }, []);

  useSpeechRecognitionEvent("start", () => {
    setStatus((current) => (current === "processing" ? current : "listening"));
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!activeRef.current || finishedRef.current) {
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
    const level = normalizeLevel(event.value);
    setLevels((current) => {
      if (current.length >= HISTORY_LENGTH) {
        return [...current.slice(current.length - HISTORY_LENGTH + 1), level];
      }
      return [...current, level];
    });
  });

  useSpeechRecognitionEvent("error", (event) => {
    // A no-speech / timeout just means the user stayed silent, and an abort is
    // our own doing.
    if (
      event.error === "no-speech" ||
      event.error === "speech-timeout" ||
      event.error === "aborted"
    ) {
      return;
    }

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
    commit();
  });

  const start = useCallback(async () => {
    if (activeRef.current) {
      return;
    }

    errorShownRef.current = false;
    setStatus("starting");

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

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

      ExpoSpeechRecognitionModule.start({
        addsPunctuation: true,
        continuous: true,
        interimResults: true,
        lang: RECOGNITION_LANG,
        maxAlternatives: 1,
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: 90,
        },
      });
    } catch (startError) {
      activeRef.current = false;
      setActive(false);
      setStatus("idle");
      Alert.alert(
        "Could not start voice input",
        startError instanceof Error
          ? startError.message
          : "An unexpected error occurred.",
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      ExpoSpeechRecognitionModule.abort();
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
