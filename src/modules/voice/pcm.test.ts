import { describe, expect, it } from "vitest";
import { floatToPcm16, prepareWhisperAudio } from "./pcm";

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

describe("float to 16-bit PCM (whisper.rn's expected input)", () => {
  it("maps full-scale floats to the int16 range", () => {
    expect(
      Array.from(floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5]))),
    ).toEqual([0, 32767, -32768, 16384, -16384]);
  });
  it("clamps out-of-range samples", () => {
    expect(Array.from(floatToPcm16(new Float32Array([2, -2])))).toEqual([
      32767, -32768,
    ]);
  });
  it("produces two bytes per sample", () => {
    expect(floatToPcm16(new Float32Array(16000)).byteLength).toBe(32000);
  });
});
