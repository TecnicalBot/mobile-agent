import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({ File: class {} }));

const { writeEditorZip } = await import("@/modules/preview/editor-zip");

function collectOutput() {
  const chunks: Uint8Array[] = [];
  const output = {
    writableStream: () =>
      new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(chunk);
        },
      }),
  };
  const bytes = () => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  };
  return { output, bytes };
}

function inputFile(name: string, bytes: Uint8Array) {
  return {
    readableStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

describe("writeEditorZip", () => {
  it("streams text and binary entries into a valid ZIP", async () => {
    const video = new TextEncoder().encode("fake-mp4-bytes");
    const { output, bytes } = collectOutput();

    await writeEditorZip(
      output as never,
      [
        {
          kind: "file",
          name: "clips/01-intro.mp4",
          file: inputFile("01-intro.mp4", video) as never,
        },
        { kind: "text", name: "README.txt", text: "hello editor" },
        { kind: "text", name: "timeline.fcpxml", text: "<fcpxml/>" },
      ],
    );

    const archive = unzipSync(bytes());
    expect(Object.keys(archive).sort()).toEqual([
      "README.txt",
      "clips/01-intro.mp4",
      "timeline.fcpxml",
    ]);
    expect(new TextDecoder().decode(archive["clips/01-intro.mp4"]!)).toBe(
      "fake-mp4-bytes",
    );
    expect(new TextDecoder().decode(archive["README.txt"]!)).toBe(
      "hello editor",
    );
    expect(new TextDecoder().decode(archive["timeline.fcpxml"]!)).toBe(
      "<fcpxml/>",
    );
  });

  it("handles binary inputs larger than one reader chunk", async () => {
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;

    const file = {
      readableStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < big.length; offset += 16_384) {
              controller.enqueue(big.slice(offset, offset + 16_384));
            }
            controller.close();
          },
        }),
    };
    const { output, bytes } = collectOutput();

    await writeEditorZip(output as never, [
      { kind: "file", name: "clips/big.mp4", file: file as never },
    ]);

    const archive = unzipSync(bytes());
    expect(archive["clips/big.mp4"]).toEqual(big);
  });

  it("aborts when a source file cannot be read", async () => {
    const file = {
      readableStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("read failed"));
          },
        }),
    };
    const { output } = collectOutput();

    await expect(
      writeEditorZip(output as never, [
        { kind: "file", name: "clips/broken.mp4", file: file as never },
      ]),
    ).rejects.toThrow(/read failed/);
  });
});
