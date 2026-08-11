import { createCreateFileTool } from "@/modules/tools/built-in/create-file";
import { createDownloadFileTool } from "@/modules/tools/built-in/download-file";
import { createEditTool } from "@/modules/tools/built-in/edit";
import { createGlobTool } from "@/modules/tools/built-in/glob";
import { createGrepTool } from "@/modules/tools/built-in/grep";
import { createListFilesTool } from "@/modules/tools/built-in/list-files";
import {
  buildSelectedFilesInlineContext,
  buildWorkspaceSystemPrompt,
} from "@/modules/tools/built-in/prompts";
import { createReadTool } from "@/modules/tools/built-in/read";
import type { WorkspaceToolFactoryParams } from "@/modules/tools/built-in/types";
import { createWriteTool } from "@/modules/tools/built-in/write";
import type { ExternalFolderSession } from "@/core/types/app-state";
import { createWorkspaceFileService } from "@/core/services/workspace-file-service";

export function createWorkspaceTools(
  params: WorkspaceToolFactoryParams & {
    session?: ExternalFolderSession | null;
  },
) {
  return {
    tools: {
      createFile: createCreateFileTool(params),
      downloadFile: createDownloadFileTool({ ...params, session: params.session }),
      edit: createEditTool(params),
      glob: createGlobTool(params),
      grep: createGrepTool(params),
      listFiles: createListFilesTool(params),
      read: createReadTool(params),
      write: createWriteTool(params),
    },
    workspaceService: createWorkspaceFileService(params.repository),
  };
}

export { buildSelectedFilesInlineContext, buildWorkspaceSystemPrompt };
