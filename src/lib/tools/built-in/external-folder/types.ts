import type { ToolExecutionRecord, ExternalFolderSession } from "@/types/app-state";

export type ExternalFolderToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
  session: ExternalFolderSession;
};
