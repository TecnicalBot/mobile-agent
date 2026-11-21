import type { WorkspaceRepository } from "@/core/db/database";
import type { ToolExecutionRecord } from "@/core/types/app-state";

export type WorkspaceToolFactoryParams = {
  /** Owning chat, captured when the run creates its tools (not the visible chat). */
  conversationId?: string;
  onProgress?: (progress: {
    bytesWritten: number;
    totalBytes: number;
  }) => void;
  onRecord?: (record: ToolExecutionRecord) => void;
  repository: WorkspaceRepository;
  /**
   * Whether the active model accepts image input. Tools that can return
   * vision content (e.g. video frames) use this to decide between inline
   * image parts and a file-link + OCR fallback. Defaults to true so existing
   * call sites keep current behavior.
   */
  supportsImageInput?: boolean;
  supportsAudioInput?: boolean;
  supportsVideoInput?: boolean;
};
