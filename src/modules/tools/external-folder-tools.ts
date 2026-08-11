import { createCreateDirectoryTool } from "@/modules/tools/built-in/external-folder/create-directory";
import { createExternalCreateFileTool } from "@/modules/tools/built-in/external-folder/create-file";
import { createDeleteEntryTool } from "@/modules/tools/built-in/external-folder/delete-entry";
import { createExternalEditTool } from "@/modules/tools/built-in/external-folder/edit";
import { createExternalGlobTool } from "@/modules/tools/built-in/external-folder/glob";
import { createExternalGrepTool } from "@/modules/tools/built-in/external-folder/grep";
import { createListDirectoryTool } from "@/modules/tools/built-in/external-folder/list-directory";
import { createMoveEntryTool } from "@/modules/tools/built-in/external-folder/move-entry";
import { buildExternalFolderSystemPrompt } from "@/modules/tools/built-in/external-folder/prompts";
import { createExternalReadTool } from "@/modules/tools/built-in/external-folder/read";
import { createRenameEntryTool } from "@/modules/tools/built-in/external-folder/rename-entry";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";
import { createExternalWriteTool } from "@/modules/tools/built-in/external-folder/write";

export function createExternalFolderTools(params: ExternalFolderToolFactoryParams) {
  return {
    tools: {
      createDirectory: createCreateDirectoryTool(params),
      createFile: createExternalCreateFileTool(params),
      deleteEntry: createDeleteEntryTool(params),
      edit: createExternalEditTool(params),
      glob: createExternalGlobTool(params),
      grep: createExternalGrepTool(params),
      listDirectory: createListDirectoryTool(params),
      moveEntry: createMoveEntryTool(params),
      read: createExternalReadTool(params),
      renameEntry: createRenameEntryTool(params),
      write: createExternalWriteTool(params),
    },
  };
}

export { buildExternalFolderSystemPrompt };
