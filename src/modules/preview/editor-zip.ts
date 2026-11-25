import { File } from "expo-file-system";
import { Zip, ZipPassThrough } from "fflate";

/**
 * Streams an editor package ZIP without loading the MP4s into the JS heap.
 *
 * `fflate`'s `Zip` is a push stream, so each file is added only when its turn
 * comes. Clips are already compressed, so they use `ZipPassThrough` (store);
 * the text timelines are small enough that storing them too keeps the code and
 * memory profile simple.
 */

export type EditorZipEntry =
  | { kind: "text"; name: string; text: string }
  | { kind: "file"; name: string; file: File };

export async function writeEditorZip(
  output: File,
  entries: EditorZipEntry[],
): Promise<void> {
  const writer = output.writableStream().getWriter();

  let failure: Error | null = null;
  let resolveDone: (() => void) | null = null;
  let rejectDone: ((error: Error) => void) | null = null;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // An early ZIP error can reject before the loop reaches `await done`; keep
  // that rejection handled so it never surfaces as an unhandled rejection.
  done.catch(() => {});

  // Ordered write chain: streams serialize writes, but awaiting the chain
  // between reads applies the writer's backpressure and keeps a large clip
  // from piling up in memory.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (chunk: Uint8Array) => {
    chain = chain.then(() => writer.write(chunk));
  };

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      rejectDone?.(failure);
      return;
    }
    if (chunk && chunk.byteLength > 0) enqueue(chunk);
    if (final) {
      chain = chain
        .then(() => writer.close())
        .then(() => resolveDone?.(), (error) => rejectDone?.(error));
    }
  });

  try {
    for (const entry of entries) {
      const input = new ZipPassThrough(entry.name);
      zip.add(input);

      if (entry.kind === "text") {
        input.push(new TextEncoder().encode(entry.text));
        input.push(new Uint8Array(0), true);
        await chain;
        continue;
      }

      const reader = entry.file.readableStream().getReader();
      try {
        for (;;) {
          const { done: readDone, value } = await reader.read();
          if (readDone) break;
          if (value && value.byteLength > 0) input.push(value);
          await chain;
        }
      } finally {
        reader.releaseLock();
      }
      input.push(new Uint8Array(0), true);
      await chain;
    }

    zip.end();
    await done;
    if (failure) throw failure;
  } catch (error) {
    try {
      zip.terminate();
    } catch {
      // Already terminated or finished.
    }
    try {
      await writer.abort();
    } catch {
      // Best-effort; the caller deletes the partial file.
    }
    throw error;
  }
}
