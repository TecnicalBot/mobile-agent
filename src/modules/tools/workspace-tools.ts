import { createCreateFileTool } from "@/modules/tools/built-in/create-file";
import { createListFilesTool } from "@/modules/tools/built-in/list-files";
import { buildSelectedFilesInlineContext } from "@/modules/tools/built-in/prompts";
import { createReadFileTool } from "@/modules/tools/built-in/read-file";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWriteFileTool } from "@/modules/tools/built-in/write-file";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

export function createWorkspaceTools(params: WorkspaceToolFactoryParams) {
  return {
    tools: {
      createFile: createCreateFileTool(params),
      listFiles: createListFilesTool(params),
      readFile: createReadFileTool(params),
      writeFile: createWriteFileTool(params),
    },
    workspaceService: createWorkspaceFileService(params.repository),
  };
}

export { buildSelectedFilesInlineContext };
