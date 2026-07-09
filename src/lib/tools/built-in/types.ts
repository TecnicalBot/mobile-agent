import type { WorkspaceRepository } from "@/lib/db/database";
import type { ToolExecutionRecord } from "@/types/app-state";

export type WorkspaceToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
  repository: WorkspaceRepository;
};
