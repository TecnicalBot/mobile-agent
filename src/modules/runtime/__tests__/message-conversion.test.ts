import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertStoredMessagesToModelMessages, MAX_DIRECT_MEDIA_BYTES, MAX_REQUEST_MEDIA_PARTS } from "@/modules/runtime/message-conversion";
import type {
  StoredMessage,
  WorkspaceFile,
} from "@/core/types/app-state";

const mocks = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; size?: number }>(),
  read: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000000"),
}));

vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///document" },
  Directory: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
    get exists() {
      return true;
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
    get exists() {
      return mocks.files.has(this.uri);
    }
    get size() {
      const file = mocks.files.get(this.uri);
      return file?.size ?? file?.bytes.length ?? 0;
    }
    async bytes() {
      mocks.read(this.uri);
      return mocks.files.get(this.uri)?.bytes ?? new Uint8Array(0);
    }
    delete() {}
  },
}));

function workspaceFile(overrides: Partial<WorkspaceFile>): WorkspaceFile {
  return {
    id: "file-1",
    displayName: "clip.mp3",
    originalName: null,
    mimeType: "audio/mpeg",
    size: 1234,
    relativePath: "file-1/clip.mp3",
    sourceKind: "imported",
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    sourceMarkdown: null,
    sourceSpec: null,
    ...overrides,
  } as WorkspaceFile;
}

function userMessage(fileIds: string[]): StoredMessage {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "user",
    content: "take a look",
    metadata: { selectedFileIds: fileIds } as StoredMessage["metadata"],
    status: "completed",
    error: null,
    sequence: 1,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

describe("convertStoredMessagesToModelMessages media passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    mocks.files.set(
      "file:///document/mobile-agent/workspace/file-1-clip.mp3",
      { bytes: new Uint8Array([1, 2, 3]) },
    );
    mocks.files.set(
      "file:///document/mobile-agent/workspace/file-2-clip.mp4",
      { bytes: new Uint8Array([4, 5, 6]) },
    );
  });

  const audio = () =>
    workspaceFile({
      id: "file-1",
      displayName: "clip.mp3",
      mimeType: "audio/mpeg",
      relativePath: "file-1-clip.mp3",
    });
  const video = () =>
    workspaceFile({
      id: "file-2",
      displayName: "clip.mp4",
      mimeType: "video/mp4",
      size: 999,
      relativePath: "file-2-clip.mp4",
    });

  function convert(
    files: WorkspaceFile[],
    flags: { audio: boolean; video: boolean },
  ) {
    return convertStoredMessagesToModelMessages({
      messages: [userMessage(files.map((file) => file.id))],
      supportsImageInput: true,
      supportsAudioInput: flags.audio,
      supportsVideoInput: flags.video,
      workspaceFilesById: new Map(files.map((file) => [file.id, file])),
    });
  }

  it("sends audio and video as file parts when the model supports them", async () => {
    const result = await convert([audio(), video()], {
      audio: true,
      video: true,
    });

    expect(result.unsupportedAttachments).toEqual([]);
    const content = (
      result.messages[0] as { content: Record<string, unknown>[] }
    ).content;
    const mediaTypes = content
      .filter((part) => part.type === "file")
      .map((part) => part.mediaType);
    expect(mediaTypes).toEqual(["audio/mpeg", "video/mp4"]);
  });

  it("lists audio and video as unsupported without model support", async () => {
    const result = await convert([audio(), video()], {
      audio: false,
      video: false,
    });

    expect(
      result.unsupportedAttachments.map((file) => file.displayName).sort(),
    ).toEqual(["clip.mp3", "clip.mp4"]);
    const message = result.messages[0] as {
      content: string | Record<string, unknown>[];
    };
    const parts = Array.isArray(message.content) ? message.content : [];
    expect(parts.some((part) => part.type === "file")).toBe(false);
  });

  it("treats oversized media as unsupported even with support", async () => {
    const big = audio();
    big.size = 26 * 1024 * 1024;
    const result = await convert([big], { audio: true, video: true });

    expect(result.unsupportedAttachments.map((file) => file.id)).toEqual([
      "file-1",
    ]);
  });

  function images(count: number, size: number) {
    return Array.from({ length: count }, (_, index) => {
      const relativePath = `image-${index}.jpg`;
      mocks.files.set(`file:///document/mobile-agent/workspace/${relativePath}`, {
        bytes: new Uint8Array([1]),
        size,
      });
      return workspaceFile({ id: `image-${index}`, relativePath, size, mimeType: "image/jpeg" });
    });
  }

  it("bounds a 261-image request before reading originals", async () => {
    const files = images(261, 1024);
    const result = await convert(files, { audio: true, video: true });
    expect(mocks.read).toHaveBeenCalledTimes(MAX_REQUEST_MEDIA_PARTS);
    expect(result.unsupportedAttachments).toHaveLength(261 - MAX_REQUEST_MEDIA_PARTS);
    expect(JSON.stringify(result.messages)).not.toContain("Their contents have not been inspected");
    expect(JSON.stringify(result.messages)).toContain("reuse prior conversation evidence");
  });

  it("shares the byte budget across chat history", async () => {
    const files = images(3, 10 * 1024 * 1024);
    const result = await convertStoredMessagesToModelMessages({
      messages: files.map((file, index) => ({ ...userMessage([file.id]), id: `message-${index}` })),
      supportsImageInput: true,
      supportsAudioInput: true,
      supportsVideoInput: true,
      workspaceFilesById: new Map(files.map((file) => [file.id, file])),
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(result.unsupportedAttachments).toEqual([files[2]]);
  });

  it("uses on-disk size instead of trusting stale workspace metadata", async () => {
    const files = images(1, MAX_DIRECT_MEDIA_BYTES + 1);
    files[0].size = 1;
    const result = await convert(files, { audio: true, video: true });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(result.unsupportedAttachments).toEqual(files);
  });

  it("does not replay stored reasoning as unsigned model input parts", async () => {
    const result = await convertStoredMessagesToModelMessages({
      messages: [{
        ...userMessage([]),
        id: "assistant-1",
        role: "assistant",
        content: "Done.",
        metadata: {
          reasoning: [{
            id: "reasoning-1",
            text: "**Inspecting final frames batch**",
            startedAt: "2026-10-14T00:00:01.000Z",
            completedAt: "2026-10-14T00:00:02.000Z",
          }],
        } as StoredMessage["metadata"],
      }],
      supportsImageInput: true,
      supportsAudioInput: true,
      supportsVideoInput: true,
      workspaceFilesById: new Map(),
    });

    expect(result.messages).toHaveLength(1);
    expect(JSON.stringify(result.messages)).not.toContain("reasoning");
    expect(result.messages[0]).toMatchObject({
      role: "assistant",
      content: "Done.",
    });
  });

  it("carries prior transcript evidence into a follow-up instead of declaring old attachments unseen", async () => {
    const original = audio();
    const result = await convertStoredMessagesToModelMessages({
      messages: [userMessage([original.id]), {
        ...userMessage([]), id: "assistant-1", role: "assistant", content: "Captioned the clip.",
        metadata: { toolExecutions: [{
          toolName: "transcribeAudio", status: "completed", inputSummary: '{"fileId":"file-1"}',
          outputSummary: '{"duration":12}', error: null, createdAt: original.updatedAt,
          mediaResult: { sourceFileId: original.id, sourceUpdatedAt: original.updatedAt, resultFileId: "transcript-1" },
        }] },
      }, { ...userMessage([]), id: "follow-up", content: "Make the text bigger." }],
      supportsImageInput: true, supportsAudioInput: false, supportsVideoInput: false,
      workspaceFilesById: new Map([[original.id, original]]),
    });
    const history = JSON.stringify(result.messages);
    expect(history).toContain("workspace://transcript-1");
    expect(history).toContain("do not re-transcribe");
    expect(history).not.toContain("Their contents have not been inspected");
    expect(result.messages.at(-1)).toMatchObject({ role: "user", content: "Make the text bigger." });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
