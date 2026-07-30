import type { WorkspaceRepository } from "@/core/db/database";
import type { ToolExecutionRecord } from "@/core/types/app-state";

export type WorkspaceToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
  repository: WorkspaceRepository;
};
