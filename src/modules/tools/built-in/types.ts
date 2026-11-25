import type { WorkspaceRepository } from "@/core/db/database";
import type { ConfigRepository } from "@/core/db/repositories/types";
import type { ToolExecutionRecord } from "@/core/types/app-state";

export type WorkspaceToolFactoryParams = {
  /** Owning chat, captured when the run creates its tools (not the visible chat). */
  conversationId?: string;
  /**
   * Read-only settings access for tools that depend on an app preference
   * (currently video rendering's optional GPU node). Omitted in contexts with
   * no settings store; those tools then use their default.
   */
  configRepository?: ConfigRepository;
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
