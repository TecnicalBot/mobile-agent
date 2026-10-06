/** Mix interleaved PCM channels to mono and resample to Whisper's 16 kHz input. */
export function prepareWhisperAudio(
  chunks: Float32Array[],
  sampleRate: number,
  channels: number,
): Float32Array {
  if (sampleRate <= 0 || channels < 1)
    throw new Error("Invalid microphone format.");
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  const frames = Math.floor(length / channels);
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      mono[frame] += input[frame * channels + channel] / channels;
    }
  }
  if (sampleRate === 16000) return mono;
  const output = new Float32Array(Math.floor((frames * 16000) / sampleRate));
  for (let index = 0; index < output.length; index++) {
    // Average the source frames for each output sample when downsampling.
    const start = (index * sampleRate) / 16000;
    const end = Math.min(frames, ((index + 1) * sampleRate) / 16000);
    let sum = 0;
    for (let frame = Math.floor(start); frame < Math.ceil(end); frame++) {
      sum += mono[frame] * (Math.min(end, frame + 1) - Math.max(start, frame));
    }
    output[index] = sum / (end - start);
  }
  return output;
}
