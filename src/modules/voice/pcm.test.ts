import { describe, expect, it } from "vitest";
import { prepareWhisperAudio } from "./pcm";

describe("Whisper microphone audio", () => {
  it("keeps mono 16 kHz samples across buffers", () => {
    expect(
      Array.from(
        prepareWhisperAudio(
          [new Float32Array([0.1, 0.2]), new Float32Array([0.3])],
          16000,
          1,
        ),
      ),
    ).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
  });
  it("mixes stereo to mono", () => {
    expect(
      Array.from(
        prepareWhisperAudio([new Float32Array([1, -1, 0.5, 0.5])], 16000, 2),
      ),
    ).toEqual([0, 0.5]);
  });
  it("resamples hardware 48 kHz audio to 16 kHz", () => {
    expect(
      Array.from(
        prepareWhisperAudio([new Float32Array([1, 1, 1, 0, 0, 0])], 48000, 1),
      ),
    ).toEqual([1, 0]);
  });
  it("accepts empty recordings", () => {
    expect(prepareWhisperAudio([], 16000, 1).length).toBe(0);
  });
});
