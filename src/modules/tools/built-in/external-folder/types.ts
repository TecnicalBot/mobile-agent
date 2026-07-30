import type { ToolExecutionRecord, ExternalFolderSession } from "@/core/types/app-state";

export type ExternalFolderToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
  session: ExternalFolderSession;
};
