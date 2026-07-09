import { createCreateFileTool } from "@/lib/tools/built-in/create-file";
import { createListFilesTool } from "@/lib/tools/built-in/list-files";
import {
  buildSelectedFilesInlineContext,
  buildWorkspaceSystemPrompt,
} from "@/lib/tools/built-in/prompts";
import { createReadFileTool } from "@/lib/tools/built-in/read-file";
import type { WorkspaceToolFactoryParams } from "@/lib/tools/built-in/types";
import { createWriteFileTool } from "@/lib/tools/built-in/write-file";
import { createWorkspaceFileService } from "@/lib/workspace/workspace-file-service";

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

export { buildSelectedFilesInlineContext, buildWorkspaceSystemPrompt };
