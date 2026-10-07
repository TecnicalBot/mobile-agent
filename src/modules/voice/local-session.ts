import { Platform } from "react-native";
import type { WhisperModelId, WhisperLanguage } from "./models";
import { isModelDownloaded, modelFile } from "./models";
import { prepareWhisperAudio, floatToPcm16 } from "./pcm";

export type LocalVoiceSession = {
  finish: () => Promise<string>;
  cancel: () => Promise<void>;
};

export async function startLocalVoiceSession(
  model: WhisperModelId,
  language: WhisperLanguage,
  onLevel: (level: number) => void,
  onLimit: () => void,
): Promise<LocalVoiceSession> {
  if (Platform.OS === "web")
    throw new Error("Local Whisper is available on Android and iOS only.");
  if (!isModelDownloaded(model))
    throw new Error(
      "The selected voice model is missing. Download it in Settings → Voice input, or select System.",
    );

  // Load native libraries only when local voice is selected, keeping System
  // usable even in development clients that have not been rebuilt yet.
  const { AudioModule, requestRecordingPermissionsAsync, setAudioModeAsync } =
    await import("expo-audio");
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted)
    throw new Error("Microphone access is required for local voice input.");
  const { initWhisper } = await import("whisper.rn/index");
  const context = await initWhisper({
    filePath: modelFile(model).uri,
    useGpu: false,
  });
  let stream: InstanceType<typeof AudioModule.AudioStream> | undefined;
  let subscription: { remove: () => void } | undefined;
  let chunks: Float32Array[] = [];
  let sampleRate = 16000;
  let channels = 1;
  let samples = 0;
  let closed = false;
  let capturing = true;
  let task: ReturnType<typeof context.transcribeData> | undefined;
  let completion: Promise<string> | undefined;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    capturing = false;
    subscription?.remove();
    stream?.stop();
    stream?.release();
    chunks = [];
    await context.release();
    await setAudioModeAsync({ allowsRecording: false });
  };
  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    stream = new AudioModule.AudioStream({
      sampleRate: 16000,
      channels: 1,
      encoding: "float32",
    });
    subscription = stream.addListener("audioStreamBuffer", (buffer) => {
      if (!capturing || closed) return;
      sampleRate = buffer.sampleRate;
      channels = buffer.channels;
      const data = new Float32Array(buffer.data.slice(0));
      chunks.push(data);
      samples += data.length;
      let energy = 0;
      for (const value of data) energy += value * value;
      onLevel(Math.min(1, Math.sqrt(energy / Math.max(1, data.length)) * 8));
      // Bound recording memory and latency to two minutes per voice message.
      if (samples / channels / sampleRate >= 120) {
        capturing = false;
        onLimit();
      }
    });
    await stream.start();
  } catch (error) {
    await cleanup();
    throw error;
  }

  const finish = () => {
    if (completion) return completion;
    if (closed) return Promise.resolve("");
    completion = (async () => {
      capturing = false;
      try {
        stream!.stop();
        if (closed || samples / channels / sampleRate < 0.3) return "";
        const audio = floatToPcm16(
          prepareWhisperAudio(chunks, sampleRate, channels),
        );
        chunks = [];
        task = context.transcribeData(audio.buffer as ArrayBuffer, {
          language,
          // Greedy decoding hallucinates on short/ambiguous clips; a small
          // beam with best-of is markedly more accurate for dictation.
          beamSize: 5,
          bestOf: 5,
          temperature: 0,
          temperatureInc: 0.2,
        });
        const result = await task.promise;
        return closed || result.isAborted ? "" : result.result.trim();
      } finally {
        closed = true;
        await cleanup();
      }
    })();
    return completion;
  };
  return {
    finish,
    cancel: async () => {
      if (closed) return;
      closed = true;
      capturing = false;
      if (completion) {
        await task?.stop();
        await completion.catch(() => {});
      } else {
        await cleanup();
      }
    },
  };
}
